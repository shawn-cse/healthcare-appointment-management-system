import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import { HttpError } from '../middleware/error.js';
import { doctorAllowed } from '../services/access.js';
import { materializeWeekly } from '../services/appointments.js';
import { logAudit } from '../services/audit.js';
import {
  serializeChamber,
  serializeDepartment,
  serializeDoctor,
  serializeUser,
  userDisplayName,
} from '../services/serialize.js';
import { parseIsoDate, parseTimeStr } from '../utils/dateTime.js';
import { hashPassword, validatePasswordStrength } from '../utils/password.js';

const PHONE_REGEX = /^\+?[0-9]{10,15}$/;

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

  const q = String(req.query.q || '').trim();
  if (q) {
    filters.push({
      OR: [
        { username: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
        { firstName: { contains: q, mode: 'insensitive' } },
        { lastName: { contains: q, mode: 'insensitive' } },
        { doctorProfile: { department: { name: { contains: q, mode: 'insensitive' } } } },
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
  else orderBy = [{ firstName: 'asc' }, { lastName: 'asc' }, { id: 'asc' }];

  const page = Math.max(1, Number(req.query.page || 1) || 1);
  const limit = 50;
  const where: Prisma.UserWhereInput = { AND: filters };

  const [total, users] = await Promise.all([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      include: {
        doctorProfile: {
          include: {
            department: true,
            chamber: true,
            weekly: true,
            receptionists: { include: { user: true } },
          },
        },
        assignedDoctors: true,
      },
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  const staff = users.map((u) => ({
    ...serializeUser(u),
    doctor_profile: u.doctorProfile
      ? serializeDoctor({ ...u.doctorProfile, user: u })
      : null,
    assigned_doctors_count: u.assignedDoctors.length,
  }));

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
  const [departments, chambers, receptionists] = await Promise.all([
    prisma.department.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
    prisma.chamber.findMany({
      where: { isActive: true },
      include: {
        department: true,
        doctors: { include: { user: true, weekly: true } },
      },
      orderBy: [{ building: 'asc' }, { roomNumber: 'asc' }],
    }),
    prisma.user.findMany({
      where: { role: 'receptionist', isActive: true },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    }),
  ]);

  res.json({
    departments: departments.map(serializeDepartment),
    chambers: chambers.map(serializeChamber),
    receptionists: receptionists.map(serializeUser),
  });
}

export async function getStaffMember(req: Request, res: Response): Promise<void> {
  const id = BigInt(req.params.id);
  const member = await prisma.user.findUnique({
    where: { id },
    include: {
      doctorProfile: {
        include: {
          department: true,
          chamber: true,
          weekly: true,
          receptionists: { include: { user: true } },
        },
      },
    },
  });
  if (!member || member.role === 'patient') {
    throw new HttpError(404, 'Staff member not found.');
  }

  res.json({
    member: {
      ...serializeUser(member),
      doctor_profile: member.doctorProfile
        ? serializeDoctor({ ...member.doctorProfile, user: member })
        : null,
    },
  });
}

export async function createStaff(req: Request, res: Response): Promise<void> {
  const body = req.body as Record<string, unknown>;
  const role = String(body.role || '').trim();
  const firstName = String(body.first_name || '').trim();
  const lastName = String(body.last_name || '').trim();
  const username = String(body.username || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();
  const dobRaw = body.dob ? String(body.dob).trim() : '';
  const nid = String(body.nid || '').trim();
  const address = String(body.address || '').trim();
  const isActive = body.is_active !== undefined ? Boolean(body.is_active) : true;
  const newPassword = String(body.new_password ?? body.password ?? '');

  if (!['doctor', 'receptionist', 'admin'].includes(role)) {
    throw new HttpError(400, 'Role must be doctor, receptionist, or admin.');
  }
  if (!firstName || !lastName || !username || !email || !phone) {
    throw new HttpError(400, 'Role, first name, last name, username, email, and phone are required.');
  }
  if (!PHONE_REGEX.test(phone)) {
    throw new HttpError(400, 'Enter a valid phone number (10–15 digits).');
  }

  const pwErr = validatePasswordStrength(newPassword);
  if (pwErr) throw new HttpError(400, pwErr);

  let dobDate: Date | null = null;
  if (dobRaw) {
    dobDate = parseIsoDate(dobRaw);
    if (!dobDate) throw new HttpError(400, 'Invalid date of birth.');
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
    where: { email: { equals: email, mode: 'insensitive' } },
  });
  if (emailConflict) {
    throw new HttpError(400, 'This email address is already associated with an account.');
  }

  const phoneConflict = await prisma.user.findFirst({ where: { phone } });
  if (phoneConflict) throw new HttpError(400, 'This phone number is already in use.');

  if (role === 'doctor') {
    if (!body.department_id && !body.department) {
      throw new HttpError(400, 'Choose a department for the new doctor.');
    }
    if (!body.assigned_receptionist_id && !body.assigned_receptionist) {
      throw new HttpError(400, 'Assign a receptionist when creating a doctor.');
    }
    if (!body.chamber_id && !body.chamber) {
      throw new HttpError(400, 'Assign a consultation chamber/room for the new doctor.');
    }
    const daysRaw = Array.isArray(body.consultation_days) ? body.consultation_days : [];
    if (!daysRaw.length) {
      throw new HttpError(
        400,
        'Select which weekly days the doctor will consult in this chamber.'
      );
    }
  }

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
        isActive,
        isStaff: role === 'admin',
        isSuperuser: role === 'admin',
        password: pwHash,
      },
    });

    if (role === 'doctor') {
      let pol = await tx.hospitalPolicy.findUnique({ where: { id: 1 } });
      if (!pol) {
        pol = await tx.hospitalPolicy.create({ data: { id: 1 } });
      }

      const departmentId = BigInt(String(body.department_id ?? body.department));
      const chamberId = BigInt(String(body.chamber_id ?? body.chamber));
      const recepId = BigInt(String(body.assigned_receptionist_id ?? body.assigned_receptionist));
      const chamber = await tx.chamber.findUnique({ where: { id: chamberId } });
      if (!chamber) throw new HttpError(400, 'Selected chamber was not found.');

      const consultationDays = (Array.isArray(body.consultation_days)
        ? body.consultation_days
        : ['0', '2', '4']
      )
        .map((d) => Number(d))
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);

      const startTime =
        parseTimeStr(String(body.consultation_start_time || '18:00')) ||
        parseTimeStr('18:00')!;
      const endTime =
        parseTimeStr(String(body.consultation_end_time || '20:00')) ||
        parseTimeStr('20:00')!;

      const doctorProfile = await tx.doctorProfile.create({
        data: {
          userId: user.id,
          departmentId,
          chamberId: chamber.id,
          chamberDays: consultationDays.join(','),
          designation: String(body.designation || 'Consultant').trim() || 'Consultant',
          qualifications: String(body.qualifications || '').trim(),
          roomNumber: chamber.roomNumber,
          chamberAddress: chamber.address,
          contactNumber: chamber.contactNumber,
          bookingNoticeHours: pol.defaultNoticeHours,
          bookingAdvanceDays: pol.defaultAdvanceDays,
          paymentDeadlineHours: pol.defaultPaymentHours,
          cancelFeeMode: pol.defaultCancelMode,
          cancelFeeValue: pol.defaultCancelValue,
          hospitalShareMode: pol.defaultHospitalMode,
          hospitalShareValue: pol.defaultHospitalValue,
        },
      });

      await tx.doctorReceptionist.create({
        data: { doctorProfileId: doctorProfile.id, userId: recepId },
      });

      for (const wd of consultationDays) {
        await tx.weeklyAvailability.create({
          data: {
            doctorId: doctorProfile.id,
            weekday: wd,
            startTime,
            endTime,
            durationMinutes: 30,
            capacity: 2,
            active: true,
          },
        });
      }

      await materializeWeekly(doctorProfile, 60, tx);
    }

    await logAudit(req.user, 'staff.saved', Number(user.id), user.role, tx);
    return user;
  });

  res.status(201).json({
    user: serializeUser(created),
    message: 'Staff account saved successfully.',
  });
}

export async function updateStaff(req: Request, res: Response): Promise<void> {
  const id = BigInt(req.params.id);
  const member = await prisma.user.findUnique({
    where: { id },
    include: { doctorProfile: true },
  });
  if (!member || member.role === 'patient') {
    throw new HttpError(404, 'Staff member not found.');
  }

  const body = req.body as Record<string, unknown>;
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

  const firstName = String(body.first_name ?? member.firstName).trim();
  const lastName = String(body.last_name ?? member.lastName).trim();
  const username = String(body.username ?? member.username).trim();
  const email = String(body.email ?? member.email).trim().toLowerCase();
  const phone = String(body.phone ?? member.phone ?? '').trim();
  const nid = String(body.nid ?? member.nid).trim();
  const address = String(body.address ?? member.address).trim();
  const dobRaw = body.dob !== undefined ? String(body.dob || '').trim() : undefined;

  if (!firstName || !lastName || !username || !email || !phone) {
    throw new HttpError(400, 'First name, last name, username, email, and phone are required.');
  }
  if (!PHONE_REGEX.test(phone)) {
    throw new HttpError(400, 'Enter a valid phone number (10–15 digits).');
  }

  let dobDate = member.dob;
  if (dobRaw !== undefined) {
    dobDate = dobRaw ? parseIsoDate(dobRaw) : null;
    if (dobRaw && !dobDate) throw new HttpError(400, 'Invalid date of birth.');
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
    where: { NOT: { id }, email: { equals: email, mode: 'insensitive' } },
  });
  if (emailConflict) {
    throw new HttpError(400, 'This email address is already associated with an account.');
  }

  const phoneConflict = await prisma.user.findFirst({
    where: { NOT: { id }, phone },
  });
  if (phoneConflict) throw new HttpError(400, 'This phone number is already in use.');

  const newPassword = String(body.new_password ?? body.password ?? '');
  let passwordHash: string | undefined;
  if (newPassword) {
    const pwErr = validatePasswordStrength(newPassword);
    if (pwErr) throw new HttpError(400, pwErr);
    passwordHash = await hashPassword(newPassword);
  }

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
        isActive,
        isStaff: role === 'admin',
        isSuperuser: role === 'admin',
        ...(passwordHash ? { password: passwordHash } : {}),
      },
    });

    if (user.role === 'doctor' && member.doctorProfile) {
      const doc = member.doctorProfile;
      const docUpdate: Prisma.DoctorProfileUpdateInput = {};

      if (body.department_id || body.department) {
        docUpdate.department = {
          connect: { id: BigInt(String(body.department_id ?? body.department)) },
        };
      }
      if ('chamber_id' in body || 'chamber' in body) {
        const rawChamber = body.chamber_id ?? body.chamber;
        if (rawChamber && /^\d+$/.test(String(rawChamber))) {
          const ch = await tx.chamber.findUnique({ where: { id: BigInt(String(rawChamber)) } });
          if (ch) {
            docUpdate.chamber = { connect: { id: ch.id } };
            docUpdate.roomNumber = ch.roomNumber;
            docUpdate.chamberAddress = ch.address;
            docUpdate.contactNumber = ch.contactNumber;
          }
        } else {
          docUpdate.chamber = { disconnect: true };
          docUpdate.roomNumber = '';
        }
      }
      if (body.designation !== undefined) {
        docUpdate.designation = String(body.designation || '').trim();
      }
      if (body.qualifications !== undefined) {
        docUpdate.qualifications = String(body.qualifications || '');
      }

      if (Object.keys(docUpdate).length) {
        await tx.doctorProfile.update({ where: { id: doc.id }, data: docUpdate });
      }

      if ('assigned_receptionist_id' in body || 'assigned_receptionist' in body) {
        const rawRec = body.assigned_receptionist_id ?? body.assigned_receptionist;
        await tx.doctorReceptionist.deleteMany({ where: { doctorProfileId: doc.id } });
        if (rawRec && /^\d+$/.test(String(rawRec))) {
          await tx.doctorReceptionist.create({
            data: { doctorProfileId: doc.id, userId: BigInt(String(rawRec)) },
          });
        }
      }
    }

    await logAudit(req.user, 'staff.saved', Number(user.id), user.role, tx);
    return user;
  });

  res.json({
    user: serializeUser(updated),
    message: 'Staff account saved successfully.',
  });
}

export async function getDoctorRules(req: Request, res: Response): Promise<void> {
  const id = BigInt(req.params.id);
  const doctor = await prisma.doctorProfile.findUnique({
    where: { id },
    include: {
      user: true,
      department: true,
      chamber: true,
      weekly: true,
      receptionists: { include: { user: true } },
    },
  });
  if (!doctor || !(await doctorAllowed(req.user!, doctor))) {
    throw new HttpError(404, 'Doctor profile not found.');
  }

  const isAdmin = req.user!.role === 'admin';
  const [departments, chambers, receptionists] = isAdmin
    ? await Promise.all([
        prisma.department.findMany({ where: { isActive: true }, orderBy: { name: 'asc' } }),
        prisma.chamber.findMany({ where: { isActive: true }, orderBy: [{ building: 'asc' }, { roomNumber: 'asc' }] }),
        prisma.user.findMany({ where: { role: 'receptionist', isActive: true }, orderBy: { firstName: 'asc' } }),
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
  const doctor = await prisma.doctorProfile.findUnique({ where: { id } });
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
    isAvailable:
      body.is_available !== undefined ? Boolean(body.is_available) : doctor.isAvailable,
  };

  if (isAdmin) {
    if (body.gender !== undefined) data.gender = String(body.gender);
    if (body.registration_number !== undefined) {
      data.registrationNumber = String(body.registration_number);
    }
    data.hospitalShareMode = hospMode;
    data.hospitalShareValue = hospVal;

    if (body.department_id || body.department) {
      data.department = {
        connect: { id: BigInt(String(body.department_id ?? body.department)) },
      };
    }

    if ('chamber_id' in body || 'chamber' in body) {
      const chRaw = body.chamber_id ?? body.chamber;
      if (chRaw && /^\d+$/.test(String(chRaw))) {
        const ch = await prisma.chamber.findUnique({ where: { id: BigInt(String(chRaw)) } });
        if (ch) {
          data.chamber = { connect: { id: ch.id } };
          data.roomNumber = ch.roomNumber;
          data.chamberAddress = ch.address;
          data.contactNumber = ch.contactNumber;
        }
      } else {
        data.chamber = { disconnect: true };
        data.roomNumber = '';
      }
    }
  }

  const updated = await prisma.$transaction(async (tx) => {
    const doc = await tx.doctorProfile.update({
      where: { id },
      data,
      include: {
        user: true,
        department: true,
        chamber: true,
        weekly: true,
        receptionists: { include: { user: true } },
      },
    });

    if (isAdmin && ('receptionist_id' in body || 'receptionist' in body)) {
      const recRaw = body.receptionist_id ?? body.receptionist;
      await tx.doctorReceptionist.deleteMany({ where: { doctorProfileId: id } });
      if (recRaw && /^\d+$/.test(String(recRaw))) {
        await tx.doctorReceptionist.create({
          data: { doctorProfileId: id, userId: BigInt(String(recRaw)) },
        });
      }
    }

    await logAudit(req.user, 'doctor.rules_updated', Number(id), '', tx);
    return tx.doctorProfile.findUniqueOrThrow({
      where: { id },
      include: {
        user: true,
        department: true,
        chamber: true,
        weekly: true,
        receptionists: { include: { user: true } },
      },
    });
  });

  res.json({
    doctor: serializeDoctor(updated),
    message: 'Doctor profile, fees and appointment rules saved.',
    doctor_title: userDisplayName(updated.user),
  });
}
