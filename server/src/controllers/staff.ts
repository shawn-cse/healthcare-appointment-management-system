import type { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import { HttpError } from '../middleware/error.js';
import { doctorAllowed } from '../services/access.js';
import { materializeWeekly } from '../services/appointments.js';
import { logAudit } from '../services/audit.js';
import { assertNoRoomWeeklyConflict, type WeeklyWindow } from '../services/roomConflict.js';
import {
  serializeChamber,
  serializeDepartment,
  serializeDoctor,
  serializeUser,
  userDisplayName,
} from '../services/serialize.js';
import { localTodayDate, parseIsoDate, parseTimeStr, timeToHm } from '../utils/dateTime.js';
import { hashPassword, validatePasswordStrength } from '../utils/password.js';
import { normalizePhone, PHONE_REGEX } from '../utils/phone.js';
import { toRelativeMediaPath } from '../utils/upload.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function staffPayload(req: Request): Record<string, unknown> {
  if (typeof req.body?.staff !== 'string') return req.body ?? {};
  try {
    const body: unknown = JSON.parse(req.body.staff);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid staff payload');
    return body as Record<string, unknown>;
  } catch { throw new HttpError(400, 'Invalid staff profile fields.'); }
}

const staffDoctorInclude = {
  department: true,
  chamber: true,
  weekly: { orderBy: [{ weekday: 'asc' as const }, { startTime: 'asc' as const }] },
  receptionists: { include: { user: true } },
};

function splitFullName(rawName: string): { firstName: string; lastName: string } {
  const parts = rawName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: '', lastName: '' };
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  const lastName = parts.pop()!;
  return { firstName: parts.join(' '), lastName };
}

function resolveNameFields(
  body: Record<string, unknown>,
  fallback?: { firstName: string; lastName: string }
): { firstName: string; lastName: string } {
  if (body.name !== undefined) {
    const { firstName, lastName } = splitFullName(String(body.name || ''));
    return { firstName, lastName };
  }
  const firstName =
    body.first_name !== undefined ? String(body.first_name).trim() : fallback?.firstName || '';
  const lastName =
    body.last_name !== undefined ? String(body.last_name).trim() : fallback?.lastName || '';
  return { firstName, lastName };
}

interface ParsedScheduleInput {
  provided: boolean;
  rules: Array<WeeklyWindow & { durationMinutes: number; capacity: number }>;
  dayNums: number[];
}

function parseScheduleInputs(body: Record<string, unknown>): ParsedScheduleInput {
  if (Array.isArray(body.schedule_rules)) {
    const rules: Array<WeeklyWindow & { durationMinutes: number; capacity: number }> = [];
    for (const raw of body.schedule_rules) {
      if (!raw || typeof raw !== 'object') continue;
      const item = raw as Record<string, unknown>;
      const wd = Number(item.weekday);
      const st = parseTimeStr(String(item.start_time || ''));
      const et = parseTimeStr(String(item.end_time || ''));
      const dur = Math.min(240, Math.max(5, Number(item.duration_minutes ?? 30) || 30));
      const cap = Math.min(100, Math.max(1, Number(item.capacity ?? 2) || 2));
      if (!Number.isInteger(wd) || wd < 0 || wd > 6 || !st || !et || timeToHm(et) <= timeToHm(st)) {
        throw new HttpError(400, 'Each weekly schedule rule must specify a valid weekday and start < end time.');
      }
      if (rules.some((rule) => rule.weekday === wd && st < rule.endTime && et > rule.startTime)) {
        throw new HttpError(400, 'Consultation sessions on the same day cannot overlap.');
      }
      rules.push({ weekday: wd, startTime: st, endTime: et, durationMinutes: dur, capacity: cap });
    }
    const dayNums = Array.from(new Set(rules.map((r) => r.weekday))).sort((a, b) => a - b);
    return { provided: true, rules, dayNums };
  }

  if ('consultation_days' in body) {
    const daysRaw = Array.isArray(body.consultation_days) ? body.consultation_days : [];
    const dayNums = Array.from(
      new Set(daysRaw.map((d) => Number(d)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))
    ).sort((a, b) => a - b);
    if (!dayNums.length) {
      return { provided: true, rules: [], dayNums: [] };
    }
    const st = parseTimeStr(String(body.consultation_start_time || '18:00'));
    const et = parseTimeStr(String(body.consultation_end_time || '20:00'));
    if (!st || !et || timeToHm(et) <= timeToHm(st)) {
      throw new HttpError(400, 'Consultation end time must be later than start time.');
    }
    const dur = Math.min(240, Math.max(5, Number(body.duration_minutes ?? 30) || 30));
    const cap = Math.min(100, Math.max(1, Number(body.capacity ?? 2) || 2));
    return {
      provided: true,
      rules: dayNums.map((wd) => ({
        weekday: wd,
        startTime: st,
        endTime: et,
        durationMinutes: dur,
        capacity: cap,
      })),
      dayNums,
    };
  }

  return { provided: false, rules: [], dayNums: [] };
}

function parseCommission(body: Record<string, unknown>, reportFee: number, followupFee: number, initialFee: number) {
  if (body.hospital_share_mode === undefined && body.hospital_share_value === undefined) return undefined;
  const mode = String(body.hospital_share_mode);
  const value = Number(body.hospital_share_value);
  const maximum = mode === 'percent' ? 100 : mode === 'fixed' ? Math.min(reportFee, followupFee, initialFee) : 9_999_999.99;
  if (!['percent', 'fixed', 'monthly'].includes(mode) || !Number.isFinite(value) || body.hospital_share_value === '' || value < 0 || value > maximum) {
    throw new HttpError(400, mode === 'fixed' ? 'The commission per appointment cannot exceed the lowest consultation fee.' : 'Enter a valid commission type and amount.');
  }
  return { hospitalShareMode: mode, hospitalShareValue: value };
}

export async function listStaff(req: Request, res: Response): Promise<void> {
  const [allCount, doctorCount, recepCount, adminCount] = await Promise.all([
    prisma.user.count({ where: { role: { not: 'patient' } } }),
    prisma.user.count({ where: { role: 'doctor' } }),
    prisma.user.count({ where: { role: 'receptionist' } }),
    prisma.user.count({ where: { role: 'admin' } }),
  ]);

  const filters: Prisma.UserWhereInput[] = [{ role: { not: 'patient' } }];
  const roleFilter = String(req.query.role || '').trim();
  if (['admin', 'doctor', 'receptionist'].includes(roleFilter)) {
    filters.push({ role: roleFilter });
  }
  if (roleFilter === 'staff') filters.push({ role: { in: ['admin', 'receptionist'] } });

  const q = String(req.query.q || '').trim();
  if (q) {
    filters.push({
      OR: [
        { username: { contains: q, mode: 'insensitive' } },
        ...(req.user?.role === 'admin' ? [{ email: { contains: q, mode: 'insensitive' as const } }] : []),
        { phone: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { chamber: { roomNumber: { contains: q, mode: 'insensitive' } } },
        { doctorProfile: { department: { name: { contains: q, mode: 'insensitive' } } } },
        { doctorProfile: { designation: { contains: q, mode: 'insensitive' } } },
        { doctorProfile: { qualifications: { contains: q, mode: 'insensitive' } } },
        { doctorProfile: { chamber: { name: { contains: q, mode: 'insensitive' } } } },
        { doctorProfile: { chamber: { building: { contains: q, mode: 'insensitive' } } } },
        { doctorProfile: { roomNumber: { contains: q, mode: 'insensitive' } } },
      ],
    });
  }

  const sort = String(req.query.sort || 'name');
  let orderBy: Prisma.UserOrderByWithRelationInput[];
  if (sort === 'username') orderBy = [{ username: 'asc' }, { id: 'asc' }];
  else if (sort === 'role') orderBy = [{ role: 'asc' }, { firstName: 'asc' }, { id: 'asc' }];
  else if (sort === 'recent') orderBy = [{ dateJoined: 'desc' }, { id: 'asc' }];
  else if (sort === 'oldest') orderBy = [{ dateJoined: 'asc' }, { id: 'asc' }];
  else orderBy = [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }];
  const [field, direction] = sort.split('.');
  if (direction === 'asc' || direction === 'desc') {
    const columns: Record<string, Prisma.UserOrderByWithRelationInput[]> = {
      name: [{ firstName: direction }, { lastName: direction }], room: [{ chamber: { roomNumber: direction } }],
      role: [{ role: direction }], contact: [{ phone: direction }],
      department: [{ doctorProfile: { department: { name: direction } } }],
      active: [{ isActive: direction }], login: [{ loginAllowed: direction }],
    };
    if (Object.hasOwn(columns, field)) orderBy = [...columns[field], { id: 'asc' }];
  }

  const page = Math.max(1, Number(req.query.page || 1) || 1);
  const limit = Math.min(100, Math.max(1, Math.trunc(Number(req.query.limit) || 50)));
  const where: Prisma.UserWhereInput = { AND: filters };

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      include: {
        chamber: true,
        doctorProfile: { include: staffDoctorInclude },
        assignedDoctors: true,
      },
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  const staff = users.map((u) => {
    const docSer = u.doctorProfile
      ? serializeDoctor({ ...u.doctorProfile, user: u })
      : null;
    const baseUser = serializeUser(u);
    if (req.user?.role !== 'admin') {
      return {
        id: baseUser.id, role: baseUser.role, role_display: baseUser.role_display,
        display_name: baseUser.display_name, username: baseUser.username, avatar: baseUser.avatar,
        phone: baseUser.phone, room_number: baseUser.room_number || docSer?.active_room || '',
        doctor_profile: docSer ? {
          id: docSer.id, designation: docSer.designation, department: docSer.department,
          assigned_receptionist_name: docSer.assigned_receptionist_name, active_room: docSer.active_room,
        } : null,
      };
    }
    return {
      ...baseUser,
      chamber_id: baseUser.chamber_id ?? docSer?.chamber_id ?? null,
      room_number: baseUser.room_number || docSer?.active_room || '',
      doctor_profile: docSer,
      assigned_doctors_count: u.assignedDoctors.length,
    };
  });

  res.json({
    staff,
    counts: {
      all: allCount,
      doctor: doctorCount,
      receptionist: recepCount,
      admin: adminCount,
    },
    total,
    page,
    total_pages: Math.max(1, Math.ceil(total / limit)),
  });
}

export async function getStaffMeta(_req: Request, res: Response): Promise<void> {
  const [departments, chambers, receptionists, policy] = await Promise.all([
    prisma.department.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
    prisma.chamber.findMany({
      where: { isActive: true },
      include: {
        department: true,
        doctors: { include: { user: true, department: true, weekly: true } },
        staffUsers: true,
      },
      orderBy: [{ building: 'asc' }, { roomNumber: 'asc' }],
    }),
    prisma.user.findMany({
      where: { role: 'receptionist', isActive: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    }),
    prisma.hospitalPolicy.findUnique({ where: { id: 1 } }),
  ]);

  res.json({
    departments: departments.map(serializeDepartment),
    chambers: chambers.map(serializeChamber),
    receptionists: receptionists.map(serializeUser),
    default_commission: { mode: policy?.defaultHospitalMode ?? 'percent', value: Number(policy?.defaultHospitalValue ?? 10) },
  });
}

export async function getStaffMember(req: Request, res: Response): Promise<void> {
  const id = BigInt(req.params.id);
  const member = await prisma.user.findUnique({
    where: { id },
    include: {
      chamber: true,
      doctorProfile: { include: staffDoctorInclude },
    },
  });
  if (!member || member.role === 'patient') {
    throw new HttpError(404, 'Staff member not found.');
  }

  const baseUser = serializeUser(member);
  const docSer = member.doctorProfile
    ? serializeDoctor({ ...member.doctorProfile, user: member })
    : null;
  res.json({
    member: {
      ...baseUser,
      chamber_id: baseUser.chamber_id ?? docSer?.chamber_id ?? null,
      room_number: baseUser.room_number || docSer?.active_room || '',
      doctor_profile: docSer,
    },
  });
}

async function resolveChamberId(body: Record<string, unknown>, fallback?: bigint | null): Promise<{
  provided: boolean;
  chamber: { id: bigint; roomNumber: string; address: string; contactNumber: string } | null;
}> {
  if (!('chamber_id' in body || 'chamber' in body || 'room_id' in body)) {
    if (!fallback) return { provided: false, chamber: null };
    const ch = await prisma.chamber.findUnique({ where: { id: fallback } });
    return { provided: false, chamber: ch };
  }
  const raw = body.chamber_id ?? body.chamber ?? body.room_id;
  if (raw && /^\d+$/.test(String(raw))) {
    const ch = await prisma.chamber.findUnique({ where: { id: BigInt(String(raw)) } });
    if (!ch) throw new HttpError(400, 'Selected room was not found.');
    return { provided: true, chamber: ch };
  }
  return { provided: true, chamber: null };
}

export async function createStaff(req: Request, res: Response): Promise<void> {
  const body = staffPayload(req);
  const role = String(body.role || '').trim();
  const { firstName, lastName } = resolveNameFields(body);
  const username = String(body.username || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phoneRaw = normalizePhone(String(body.phone || ''));
  const dobRaw = body.dob ? String(body.dob).trim() : '';
  const nid = String(body.nid || '').trim();
  const address = String(body.address || '').trim();
  const isActive = body.is_active !== undefined ? Boolean(body.is_active) : true;
  const newPassword = String(body.new_password ?? body.password ?? '');
  const registrationNumber = String(body.registration_number ?? '').trim();

  if (!['doctor', 'receptionist', 'admin'].includes(role)) {
    throw new HttpError(400, 'Role must be doctor, receptionist, or admin.');
  }
  if (!firstName || !username || !email) {
    throw new HttpError(400, 'Role, name, username, and email address are required.');
  }
  if (!EMAIL_REGEX.test(email)) {
    throw new HttpError(400, 'Enter a valid email address.');
  }
  if (phoneRaw && !PHONE_REGEX.test(phoneRaw)) {
    throw new HttpError(400, 'Enter a valid phone number (10–15 digits) or leave it blank.');
  }
  const phone: string | null = phoneRaw || null;

  const pwErr = validatePasswordStrength(newPassword);
  if (pwErr) throw new HttpError(400, pwErr);

  let dobDate: Date | null = null;
  if (dobRaw) {
    dobDate = parseIsoDate(dobRaw);
    if (!dobDate || dobDate > new Date()) throw new HttpError(400, 'Invalid date of birth.');
  }
  if (role === 'doctor' && (!dobDate || !registrationNumber)) {
    throw new HttpError(400, 'Date of birth and BMDC registration number are required for doctors.');
  }

  const usernameConflict = await prisma.user.findFirst({
    where: {
      OR: [
        { username: { equals: username, mode: 'insensitive' } },
        { phone: username },
        { email: { equals: username, mode: 'insensitive' } },
      ],
    },
  });
  if (usernameConflict) {
    throw new HttpError(400, 'This username conflicts with another account identifier.');
  }

  const emailConflict = await prisma.user.findFirst({
    where: {
      OR: [
        { email: { equals: email, mode: 'insensitive' } },
        { username: { equals: email, mode: 'insensitive' } },
      ],
    },
  });
  if (emailConflict) {
    throw new HttpError(400, 'This email address is already associated with an account.');
  }

  const { chamber } = await resolveChamberId(body);
  const parsedSched = parseScheduleInputs(body);
  const pwHash = await hashPassword(newPassword);

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        role,
        firstName,
        lastName,
        username,
        email,
        phone,
        dob: dobDate,
        nid,
        address,
        gender: ['male', 'female', 'other'].includes(String(body.gender)) ? String(body.gender) : null,
        ...(req.file ? { avatar: toRelativeMediaPath('profiles', req.file.filename) } : {}),
        chamberId: chamber ? chamber.id : null,
        isActive,
        loginAllowed: isActive && body.login_allowed !== false,
        isStaff: role === 'admin',
        isSuperuser: role === 'admin',
        password: pwHash,
      },
      include: { chamber: true },
    });

    if (role === 'doctor') {
      let pol = await tx.hospitalPolicy.findUnique({ where: { id: 1 } });
      if (!pol) {
        pol = await tx.hospitalPolicy.create({ data: { id: 1 } });
      }

      const deptRaw = body.department_id ?? body.department;
      const departmentId =
        deptRaw !== undefined && deptRaw !== null && /^\d+$/.test(String(deptRaw))
          ? BigInt(String(deptRaw))
          : null;

      const recRaw = body.assigned_receptionist_id ?? body.assigned_receptionist;
      const recepId =
        recRaw !== undefined && recRaw !== null && /^\d+$/.test(String(recRaw))
          ? BigInt(String(recRaw))
          : null;

      const gender = ['male', 'female', 'other'].includes(String(body.gender || ''))
        ? String(body.gender)
        : 'male';

      if (chamber && parsedSched.rules.length > 0 && isActive) {
        await assertNoRoomWeeklyConflict(tx, {
          chamberId: chamber.id,
          rules: parsedSched.rules,
        });
      }

      const doctorProfile = await tx.doctorProfile.create({
        data: {
          userId: user.id,
          departmentId,
          chamberId: chamber ? chamber.id : null,
          chamberDays: parsedSched.dayNums.join(','),
          gender,
          designation: String(body.designation || 'Consultant').trim() || 'Consultant',
          qualifications: String(body.qualifications || '').trim(),
          professionalExperience: String(body.professional_experience || '').trim(),
          registrationNumber,
          roomNumber: chamber ? chamber.roomNumber : '',
          chamberAddress: chamber ? chamber.address : 'Mirpur, Dhaka',
          contactNumber: chamber ? chamber.contactNumber : '+88096100016211',
          bookingNoticeHours: pol.defaultNoticeHours,
          bookingAdvanceDays: pol.defaultAdvanceDays,
          paymentDeadlineHours: pol.defaultPaymentHours,
          cancelFeeMode: pol.defaultCancelMode,
          cancelFeeValue: pol.defaultCancelValue,
          hospitalShareMode: pol.defaultHospitalMode,
          hospitalShareValue: pol.defaultHospitalValue,
          ...parseCommission(body, 500, 800, 1000),
          isAvailable: true,
        },
      });

      if (recepId) {
        const receptionist = await tx.user.findFirst({ where: { id: recepId, role: 'receptionist', isActive: true } });
        if (!receptionist) throw new HttpError(400, 'Select an active receptionist.');
        await tx.doctorReceptionist.create({
          data: { doctorProfileId: doctorProfile.id, userId: recepId },
        });
      }

      for (const r of parsedSched.rules) {
        await tx.weeklyAvailability.create({
          data: {
            doctorId: doctorProfile.id,
            weekday: r.weekday,
            startTime: r.startTime,
            endTime: r.endTime,
            durationMinutes: r.durationMinutes,
            capacity: r.capacity,
            active: true,
          },
        });
      }

      if (parsedSched.rules.length > 0) {
        await materializeWeekly(doctorProfile, 60, tx);
      }
    }

    await logAudit(req.user, 'staff.saved', Number(user.id), user.role, tx);
    return user;
  });

  res.status(201).json({
    user: serializeUser(created),
    message: 'Staff account created successfully.',
  });
}

export async function updateStaff(req: Request, res: Response): Promise<void> {
  const id = BigInt(req.params.id);
  const member = await prisma.user.findUnique({
    where: { id },
    include: {
      chamber: true,
      doctorProfile: { include: { weekly: true } },
    },
  });
  if (!member || member.role === 'patient') {
    throw new HttpError(404, 'Staff member not found.');
  }

  const body = staffPayload(req);
  const role = body.role !== undefined ? String(body.role).trim() : member.role;
  if (role !== member.role) {
    throw new HttpError(400, 'For audit integrity, create a new account for a different staff role.');
  }

  const isActive = body.is_active !== undefined ? Boolean(body.is_active) : member.isActive;
  if (member.id === req.user!.id && (role !== 'admin' || !isActive)) {
    throw new HttpError(
      400,
      'You cannot deactivate your own administrator account or remove its role.'
    );
  }

  const { firstName, lastName } = resolveNameFields(body, {
    firstName: member.firstName,
    lastName: member.lastName,
  });
  const username = String(body.username ?? member.username).trim();
  const email = String(body.email ?? member.email).trim().toLowerCase();
  const phoneRaw = normalizePhone(String(body.phone ?? member.phone ?? ''));
  const nid = String(body.nid ?? member.nid).trim();
  const address = String(body.address ?? member.address).trim();
  const dobRaw = body.dob !== undefined ? String(body.dob || '').trim() : undefined;

  if (!firstName || !username || !email) {
    throw new HttpError(400, 'Name, username, and email address are required.');
  }
  if (!EMAIL_REGEX.test(email)) {
    throw new HttpError(400, 'Enter a valid email address.');
  }
  if (phoneRaw && !PHONE_REGEX.test(phoneRaw)) {
    throw new HttpError(400, 'Enter a valid phone number (10–15 digits) or leave it blank.');
  }
  const phone: string | null = phoneRaw || null;

  let dobDate = member.dob;
  if (dobRaw !== undefined) {
    dobDate = dobRaw ? parseIsoDate(dobRaw) : null;
    if (dobRaw && (!dobDate || dobDate > new Date())) throw new HttpError(400, 'Invalid date of birth.');
    if (role === 'doctor' && member.dob && !dobDate) throw new HttpError(400, 'Date of birth is required for doctors.');
  }

  const usernameConflict = await prisma.user.findFirst({
    where: {
      NOT: { id },
      OR: [
        { username: { equals: username, mode: 'insensitive' } },
        { phone: username },
        { email: { equals: username, mode: 'insensitive' } },
      ],
    },
  });
  if (usernameConflict) {
    throw new HttpError(400, 'This username conflicts with another account identifier.');
  }

  const emailConflict = await prisma.user.findFirst({
    where: {
      NOT: { id },
      OR: [
        { email: { equals: email, mode: 'insensitive' } },
        { username: { equals: email, mode: 'insensitive' } },
      ],
    },
  });
  if (emailConflict) {
    throw new HttpError(400, 'This email address is already associated with an account.');
  }

  const newPassword = String(body.new_password ?? body.password ?? '');
  let passwordHash: string | undefined;
  if (newPassword) {
    const pwErr = validatePasswordStrength(newPassword);
    if (pwErr) throw new HttpError(400, pwErr);
    passwordHash = await hashPassword(newPassword);
  }

  const chamberRes = await resolveChamberId(
    body,
    member.chamberId ?? member.doctorProfile?.chamberId ?? null
  );
  const parsedSched = parseScheduleInputs(body);

  const updated = await prisma.$transaction(async (tx) => {
    const user = await tx.user.update({
      where: { id },
      data: {
        firstName,
        lastName,
        username,
        email,
        phone,
        dob: dobDate,
        nid,
        address,
        ...(body.gender !== undefined && ['male', 'female', 'other'].includes(String(body.gender)) ? { gender: String(body.gender) } : {}),
        ...(req.file ? { avatar: toRelativeMediaPath('profiles', req.file.filename) } : {}),
        ...(chamberRes.provided ? { chamberId: chamberRes.chamber?.id ?? null } : {}),
        isActive,
        ...(isActive !== member.isActive ? { loginAllowed: isActive } : {}),
        isStaff: role === 'admin',
        isSuperuser: role === 'admin',
        ...(passwordHash ? { password: passwordHash } : {}),
        ...(passwordHash || (member.isActive && !isActive) ? { sessionVersion: { increment: 1 } } : {}),
      },
      include: { chamber: true },
    });

    if (user.role === 'doctor' && member.doctorProfile) {
      await tx.$queryRaw`SELECT id FROM hospital_doctorprofile WHERE id = ${member.doctorProfile.id} FOR UPDATE`;
      const doc = await tx.doctorProfile.findUniqueOrThrow({ where: { id: member.doctorProfile.id }, include: { weekly: true } });
      const targetChamberId = chamberRes.provided ? chamberRes.chamber?.id ?? null : doc.chamberId;

      const windowsToCheck: WeeklyWindow[] = parsedSched.provided
        ? parsedSched.rules
        : (doc.weekly || []).filter((w) => w.active).map((w) => ({
            weekday: w.weekday,
            startTime: w.startTime,
            endTime: w.endTime,
          }));

      if (isActive && targetChamberId && windowsToCheck.length > 0) {
        await assertNoRoomWeeklyConflict(tx, {
          chamberId: targetChamberId,
          excludeDoctorId: doc.id,
          rules: windowsToCheck,
        });
      }

      const docUpdate: Prisma.DoctorProfileUpdateInput = {
        ...parseCommission(body, Number(doc.reportFee), Number(doc.followupFee), Number(doc.initialFee)),
        ...(body.professional_experience !== undefined ? { professionalExperience: String(body.professional_experience).trim() } : {}),
      };
      if (body.registration_number !== undefined) {
        const value = String(body.registration_number).trim();
        if (!value) throw new HttpError(400, 'BMDC registration number is required for doctors.');
        docUpdate.registrationNumber = value;
      }

      if ('department_id' in body || 'department' in body) {
        const dRaw = body.department_id ?? body.department;
        if (dRaw && /^\d+$/.test(String(dRaw))) {
          docUpdate.department = { connect: { id: BigInt(String(dRaw)) } };
        } else {
          docUpdate.department = { disconnect: true };
        }
      }

      if (chamberRes.provided) {
        if (chamberRes.chamber) {
          docUpdate.chamber = { connect: { id: chamberRes.chamber.id } };
          docUpdate.roomNumber = chamberRes.chamber.roomNumber;
          docUpdate.chamberAddress = chamberRes.chamber.address;
          docUpdate.contactNumber = chamberRes.chamber.contactNumber;
        } else {
          docUpdate.chamber = { disconnect: true };
          docUpdate.roomNumber = '';
        }
      }

      if (body.gender !== undefined && ['male', 'female', 'other'].includes(String(body.gender))) {
        docUpdate.gender = String(body.gender);
      }
      if (body.designation !== undefined) {
        docUpdate.designation = String(body.designation || '').trim();
      }
      if (body.qualifications !== undefined) {
        docUpdate.qualifications = String(body.qualifications || '');
      }
      if (parsedSched.provided) {
        docUpdate.chamberDays = parsedSched.dayNums.join(',');
      }

      const updatedDoc = await tx.doctorProfile.update({
        where: { id: doc.id },
        data: docUpdate,
      });

      if ('assigned_receptionist_id' in body || 'assigned_receptionist' in body) {
        const rawRec = body.assigned_receptionist_id ?? body.assigned_receptionist;
        await tx.doctorReceptionist.deleteMany({ where: { doctorProfileId: doc.id } });
        if (rawRec && /^\d+$/.test(String(rawRec))) {
          const receptionist = await tx.user.findFirst({ where: { id: BigInt(String(rawRec)), role: 'receptionist', isActive: true } });
          if (!receptionist) throw new HttpError(400, 'Select an active receptionist.');
          await tx.doctorReceptionist.create({
            data: { doctorProfileId: doc.id, userId: BigInt(String(rawRec)) },
          });
        }
      }

      if (parsedSched.provided) {
        const key = (r: WeeklyWindow) => `${r.weekday}/${timeToHm(r.startTime)}/${timeToHm(r.endTime)}`;
        const requested = new Set(parsedSched.rules.map(key));
        const existing = doc.weekly.filter((r) => r.active);
        const preserved = new Set(existing.filter((r) => requested.has(key(r))).map(key));
        const removed = existing.filter((r) => !requested.has(key(r))).map((r) => r.id);
        if (removed.length) {
          const today = localTodayDate();
          await tx.$queryRaw`SELECT id FROM hospital_appointmentslot WHERE template_id IN (${Prisma.join(removed)}) AND date >= ${today}::date FOR UPDATE`;
          const affected = { templateId: { in: removed }, date: { gte: today } };
          await tx.appointmentSlot.deleteMany({ where: { ...affected, appointments: { none: {} } } });
          await tx.appointmentSlot.updateMany({ where: affected, data: { isOpen: false } });
          await tx.weeklyAvailability.updateMany({ where: { id: { in: removed } }, data: { active: false } });
        }
        for (const r of parsedSched.rules) {
          if (preserved.has(key(r))) continue;
          await tx.weeklyAvailability.create({
            data: {
              doctorId: doc.id,
              weekday: r.weekday,
              startTime: r.startTime,
              endTime: r.endTime,
              durationMinutes: r.durationMinutes,
              capacity: r.capacity,
              active: true,
            },
          });
        }
        if (parsedSched.rules.length > 0 && isActive) {
          await materializeWeekly(updatedDoc, 60, tx);
        }
      }
    }

    await logAudit(req.user, 'staff.saved', Number(user.id), user.role, tx);
    return user;
  });

  res.json({
    user: serializeUser(updated),
    message: 'Staff account updated successfully.',
  });
}

export async function toggleStaffActive(req: Request, res: Response): Promise<void> {
  const id = BigInt(req.params.id);
  const member = await prisma.user.findUnique({
    where: { id },
    include: { chamber: true, doctorProfile: true },
  });
  if (!member) throw new HttpError(404, 'Account not found.');
  if (member.id === req.user!.id) {
    throw new HttpError(400, 'You cannot deactivate your own administrator account.');
  }

  const nextActive = !member.isActive;
  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id },
      data: { isActive: nextActive, ...(member.role !== 'patient' ? { loginAllowed: nextActive, ...(!nextActive ? { sessionVersion: { increment: 1 } } : {}) } : {}) },
      include: { chamber: true },
    });
    if (nextActive && member.doctorProfile?.chamberId) {
      const rules = await tx.weeklyAvailability.findMany({ where: { doctorId: member.doctorProfile.id, active: true } });
      await assertNoRoomWeeklyConflict(tx, { chamberId: member.doctorProfile.chamberId, excludeDoctorId: member.doctorProfile.id, rules });
    }
    await logAudit(
      req.user,
      nextActive ? 'staff.activated' : 'staff.deactivated',
      Number(id),
      u.username,
      tx
    );
    return u;
  });

  res.json({
    user: serializeUser(updated),
    message: `${userDisplayName(updated)} has been ${nextActive ? 'activated' : 'deactivated'}.`,
  });
}

export async function setLoginPermission(req: Request, res: Response): Promise<void> {
  const id = BigInt(req.params.id);
  const allowed = req.body?.login_allowed;
  if (typeof allowed !== 'boolean') throw new HttpError(400, 'Select a login permission.');
  if (id === req.user!.id && !allowed) throw new HttpError(400, 'You cannot block your own administrator account.');
  const updated = await prisma.$transaction(async (tx) => {
    const account = await tx.user.findUnique({ where: { id }, select: { role: true, isActive: true } });
    if (!account) throw new HttpError(404, 'Account not found.');
    if (allowed && !account.isActive && account.role !== 'patient') throw new HttpError(400, 'Activate this staff account before allowing login.');
    const member = await tx.user.update({ where: { id }, data: {
      loginAllowed: allowed,
      ...(!allowed ? { sessionVersion: { increment: 1 } } : {}),
    } });
    await logAudit(req.user, allowed ? 'account.login_allowed' : 'account.login_blocked', Number(id), member.username, tx);
    return member;
  });
  res.json({ user: serializeUser(updated), message: allowed ? 'Login allowed.' : 'Login blocked.' });
}

export async function getDoctorRules(req: Request, res: Response): Promise<void> {
  const id = BigInt(req.params.id);
  const doctor = await prisma.doctorProfile.findUnique({
    where: { id },
    include: {
      user: true,
      ...staffDoctorInclude,
    },
  });
  if (!doctor || !(await doctorAllowed(req.user!, doctor))) {
    throw new HttpError(404, 'Doctor profile not found.');
  }

  const isAdmin = req.user!.role === 'admin';
  const [departments, chambers, receptionists] = isAdmin
    ? await Promise.all([
        prisma.department.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
        prisma.chamber.findMany({
          where: { isActive: true },
          orderBy: [{ building: 'asc' }, { roomNumber: 'asc' }],
        }),
        prisma.user.findMany({
          where: { role: 'receptionist', isActive: true },
          orderBy: { firstName: 'asc' },
        }),
      ])
    : [[], [], []];

  res.json({
    doctor: serializeDoctor(doctor),
    is_admin: isAdmin,
    departments: departments.map(serializeDepartment),
    chambers: chambers.map(serializeChamber),
    receptionists: receptionists.map(serializeUser),
  });
}

export async function updateDoctorRules(req: Request, res: Response): Promise<void> {
  const id = BigInt(req.params.id);
  const doctor = await prisma.doctorProfile.findUnique({
    where: { id },
    include: { weekly: true },
  });
  if (!doctor || !(await doctorAllowed(req.user!, doctor))) {
    throw new HttpError(403, 'Not authorized.');
  }

  const isAdmin = req.user!.role === 'admin';
  const body = req.body as Record<string, unknown>;

  const cancelMode = String(body.cancel_fee_mode ?? doctor.cancelFeeMode);
  const cancelVal = Number(body.cancel_fee_value ?? doctor.cancelFeeValue);
  if (cancelMode === 'percent' && cancelVal > 100) {
    throw new HttpError(400, 'Percentage cannot exceed 100.');
  }

  const hospMode = isAdmin
    ? String(body.hospital_share_mode ?? doctor.hospitalShareMode)
    : doctor.hospitalShareMode;
  const hospVal = isAdmin
    ? Number(body.hospital_share_value ?? doctor.hospitalShareValue)
    : Number(doctor.hospitalShareValue);
  if (hospMode === 'percent' && hospVal > 100) {
    throw new HttpError(400, 'Percentage cannot exceed 100.');
  }
  const fees = [Number(body.initial_fee ?? doctor.initialFee), Number(body.followup_fee ?? doctor.followupFee), Number(body.report_fee ?? doctor.reportFee)];
  if (fees.some((value) => !Number.isFinite(value) || value < 0 || value > 9_999_999.99)) throw new HttpError(400, 'Enter valid consultation fees.');
  if (!['percent', 'fixed', 'monthly'].includes(hospMode) || !Number.isFinite(hospVal) || hospVal < 0 || hospVal > 9_999_999.99 || (hospMode === 'fixed' && hospVal > Math.min(...fees))) throw new HttpError(400, 'Enter a valid hospital commission.');
  if (!['percent', 'fixed'].includes(cancelMode) || !Number.isFinite(cancelVal) || cancelVal < 0 || cancelVal > 9_999_999.99) throw new HttpError(400, 'Enter a valid cancellation policy.');
  const window = body.booking_window_hours === undefined ? doctor.bookingWindowHours : Number(body.booking_window_hours);
  const deadline = Number(body.payment_deadline_hours ?? doctor.paymentDeadlineHours);
  const reportDays = Number(body.report_within_days ?? doctor.reportWithinDays);
  const followupDays = Number(body.followup_within_days ?? doctor.followupWithinDays);
  const paymentPolicy = String(body.payment_policy ?? doctor.paymentPolicy);
  if (![deadline, reportDays, followupDays].every((n) => Number.isInteger(n) && n > 0 && n <= 4320) || !['on_day', 'within'].includes(paymentPolicy)) throw new HttpError(400, 'Select valid payment and visit deadlines.');
  if (window !== null && (!Number.isInteger(window) || window < 1 || window > 4320 || (paymentPolicy === 'within' && deadline >= window))) throw new HttpError(400, 'The booking window must be longer than the advance payment deadline.');
  const methods = body.accepted_payment_methods === undefined ? doctor.acceptedPaymentMethods.split(',') : body.accepted_payment_methods;
  if (!Array.isArray(methods) || !methods.length || methods.some((method) => method !== 'cash' && method !== 'online')) throw new HttpError(400, 'Select at least one accepted payment method.');

  const data: Prisma.DoctorProfileUpdateInput = {
    designation: body.designation !== undefined ? String(body.designation) : doctor.designation,
    qualifications:
      body.qualifications !== undefined ? String(body.qualifications) : doctor.qualifications,
    experienceYears:
      body.experience_years !== undefined ? Number(body.experience_years) : doctor.experienceYears,
    biography: body.biography !== undefined ? String(body.biography) : doctor.biography,
    initialFee: body.initial_fee !== undefined ? Number(body.initial_fee) : doctor.initialFee,
    followupFee: body.followup_fee !== undefined ? Number(body.followup_fee) : doctor.followupFee,
    followupWithinDays:
      body.followup_within_days !== undefined
        ? Math.max(1, Number(body.followup_within_days))
        : doctor.followupWithinDays,
    reportFee: body.report_fee !== undefined ? Number(body.report_fee) : doctor.reportFee,
    reportWithinDays: reportDays,
    bookingWindowHours: window,
    acceptedPaymentMethods: [...new Set(methods)].join(','),
    bookingNoticeHours:
      body.booking_notice_hours !== undefined
        ? Math.max(0, Number(body.booking_notice_hours))
        : doctor.bookingNoticeHours,
    bookingAdvanceDays:
      body.booking_advance_days !== undefined
        ? Math.max(1, Number(body.booking_advance_days))
        : doctor.bookingAdvanceDays,
    paymentPolicy:
      body.payment_policy !== undefined ? String(body.payment_policy) : doctor.paymentPolicy,
    paymentDeadlineHours:
      body.payment_deadline_hours !== undefined
        ? Math.max(1, Number(body.payment_deadline_hours))
        : doctor.paymentDeadlineHours,
    cancelFeeMode: cancelMode,
    cancelFeeValue: cancelVal,
    ...(isAdmin && body.is_available !== undefined ? { isAvailable: body.is_available === true } : {}),
  };

  let syncUserChamberId: bigint | null | undefined = undefined;
  if (isAdmin) {
    if (body.gender !== undefined) data.gender = String(body.gender);
    if (body.registration_number !== undefined) {
      data.registrationNumber = String(body.registration_number);
    }
    data.hospitalShareMode = hospMode;
    data.hospitalShareValue = hospVal;

    if ('department_id' in body || 'department' in body) {
      const deptVal = body.department_id ?? body.department;
      if (deptVal && /^\d+$/.test(String(deptVal))) {
        data.department = { connect: { id: BigInt(String(deptVal)) } };
      } else {
        data.department = { disconnect: true };
      }
    }

    if ('chamber_id' in body || 'chamber' in body) {
      const chRaw = body.chamber_id ?? body.chamber;
      if (chRaw && /^\d+$/.test(String(chRaw))) {
        const ch = await prisma.chamber.findUnique({ where: { id: BigInt(String(chRaw)) } });
        if (ch) {
          await assertNoRoomWeeklyConflict(prisma, {
            chamberId: ch.id,
            excludeDoctorId: id,
            rules: (doctor.weekly || []).filter((w) => w.active).map((w) => ({
              weekday: w.weekday,
              startTime: w.startTime,
              endTime: w.endTime,
            })),
          });
          data.chamber = { connect: { id: ch.id } };
          data.roomNumber = ch.roomNumber;
          data.chamberAddress = ch.address;
          data.contactNumber = ch.contactNumber;
          syncUserChamberId = ch.id;
        }
      } else {
        data.chamber = { disconnect: true };
        data.roomNumber = '';
        syncUserChamberId = null;
      }
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const doc = await tx.doctorProfile.update({
      where: { id },
      data,
      include: { user: true, ...staffDoctorInclude },
    });

    if (syncUserChamberId !== undefined) {
      await tx.user.update({
        where: { id: doc.userId },
        data: { chamberId: syncUserChamberId },
      });
    }

    if (isAdmin && ('receptionist_id' in body || 'receptionist' in body)) {
      const recRaw = body.receptionist_id ?? body.receptionist;
      await tx.doctorReceptionist.deleteMany({ where: { doctorProfileId: id } });
      if (recRaw && /^\d+$/.test(String(recRaw))) {
        await tx.doctorReceptionist.create({
          data: { doctorProfileId: id, userId: BigInt(String(recRaw)) },
        });
      }
    }

    const before = { fees: [doctor.initialFee, doctor.followupFee, doctor.reportFee], commission: [doctor.hospitalShareMode, doctor.hospitalShareValue], booking: [doctor.bookingWindowHours, doctor.paymentDeadlineHours], methods: doctor.acceptedPaymentMethods };
    const after = { fees: [doc.initialFee, doc.followupFee, doc.reportFee], commission: [doc.hospitalShareMode, doc.hospitalShareValue], booking: [doc.bookingWindowHours, doc.paymentDeadlineHours], methods: doc.acceptedPaymentMethods };
    await logAudit(req.user, 'doctor.rules_updated', Number(id), JSON.stringify({ before, after }), tx);
    return tx.doctorProfile.findUniqueOrThrow({
      where: { id },
      include: { user: true, ...staffDoctorInclude },
    });
  });

  res.json({
    doctor: serializeDoctor(updated),
    message: 'Doctor profile, fees and appointment rules saved.',
    doctor_title: userDisplayName(updated.user),
  });
}
