import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { HttpError } from '../middleware/error.js';
import { doctorAllowed, managedDoctorIds } from '../services/access.js';
import { ACTIVE_APPOINTMENT_STATUSES, materializeWeekly } from '../services/appointments.js';
import { logAudit } from '../services/audit.js';
import { gatewayHttpsReady } from '../services/gateway.js';
import {
  serializeChamber,
  serializeDepartment,
  serializeDoctor,
  serializeSlot,
  serializeWeekly,
  userDisplayName,
} from '../services/serialize.js';
import {
  addDaysDate,
  dateToIso,
  localStartUtc,
  localTodayDate,
  parseIsoDate,
  parseTimeStr,
  pythonWeekday,
  timeTo12h,
  timeToHm,
} from '../utils/dateTime.js';

function slugify(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);
}

const doctorInclude = {
  user: true,
  department: true,
  chamber: true,
  weekly: { orderBy: [{ weekday: 'asc' as const }, { startTime: 'asc' as const }] },
  receptionists: { include: { user: true } },
};

// ---------- Public Home ----------
export async function publicHome(_req: Request, res: Response): Promise<void> {
  const departments = await prisma.department.findMany({
    where: {
      isActive: true,
      doctors: {
        some: { isAvailable: true, user: { isActive: true } },
      },
    },
    orderBy: { name: 'asc' },
    take: 10,
  });

  const [doctors, doctorCount] = await Promise.all([
    prisma.doctorProfile.findMany({
      where: { isAvailable: true, user: { isActive: true }, department: { isActive: true } },
      include: doctorInclude,
      take: 6,
      orderBy: { id: 'asc' },
    }),
    prisma.doctorProfile.count({
      where: { user: { isActive: true }, department: { isActive: true } },
    }),
  ]);

  res.json({
    hospital: {
      name: env.hospitalName,
      phone: env.hospitalPhone,
      address: env.hospitalAddress,
    },
    departments: departments.map(serializeDepartment),
    doctors: doctors.map(serializeDoctor),
    doctor_count: doctorCount,
  });
}

// ---------- Doctor Directory ----------
export async function doctorDirectory(req: Request, res: Response): Promise<void> {
  const deptParam = req.query.department;
  const deptRaw = Array.isArray(deptParam)
    ? deptParam.map(String)
    : typeof deptParam === 'string' && deptParam
      ? deptParam.split(',')
      : [];
  const deptIds = deptRaw.filter((d) => /^\d+$/.test(d.trim())).map((d) => BigInt(d.trim()));

  const genderParam = req.query.gender;
  const genderRaw = Array.isArray(genderParam)
    ? genderParam.map((g) => String(g).toLowerCase())
    : typeof genderParam === 'string' && genderParam
      ? [genderParam.toLowerCase()]
      : [];
  const genders = genderRaw.filter((g) => g === 'male' || g === 'female');

  const q = String(req.query.q || '').trim();
  const sort = String(req.query.sort || 'default');

  const where: Prisma.DoctorProfileWhereInput = {
    isAvailable: true,
    user: { isActive: true },
    department: { isActive: true },
    ...(deptIds.length ? { departmentId: { in: deptIds } } : {}),
    ...(genders.length === 1 ? { gender: genders[0] } : {}),
    ...(q
      ? {
          OR: [
            { user: { firstName: { contains: q, mode: 'insensitive' } } },
            { user: { lastName: { contains: q, mode: 'insensitive' } } },
            { department: { name: { contains: q, mode: 'insensitive' } } },
            { qualifications: { contains: q, mode: 'insensitive' } },
            { designation: { contains: q, mode: 'insensitive' } },
            { institute: { contains: q, mode: 'insensitive' } },
            { roomNumber: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  let orderBy: Prisma.DoctorProfileOrderByWithRelationInput = { id: 'asc' };
  if (sort === 'fee_asc') orderBy = { initialFee: 'asc' };
  else if (sort === 'fee_desc') orderBy = { initialFee: 'desc' };
  else if (sort === 'experience') orderBy = { experienceYears: 'desc' };

  const [doctors, departments, totalCount] = await Promise.all([
    prisma.doctorProfile.findMany({ where, include: doctorInclude, orderBy }),
    prisma.department.findMany({
      where: {
        isActive: true,
        doctors: { some: { isAvailable: true, user: { isActive: true } } },
      },
      orderBy: { name: 'asc' },
    }),
    prisma.doctorProfile.count({
      where: { isAvailable: true, user: { isActive: true }, department: { isActive: true } },
    }),
  ]);

  res.json({
    doctors: doctors.map(serializeDoctor),
    departments: departments.map(serializeDepartment),
    total_doctors_count: totalCount,
  });
}

async function resolveDoctor(identifier: string) {
  const identStr = identifier.trim();
  if (!identStr) return null;

  if (/^\d+$/.test(identStr)) {
    const byId = await prisma.doctorProfile.findFirst({
      where: { id: BigInt(identStr), user: { isActive: true } },
      include: doctorInclude,
    });
    if (byId) return byId;
  }

  const clean = identStr.toLowerCase();
  const under = clean.replace(/-/g, '_');
  const dash = clean.replace(/_/g, '-');

  const byUsername = await prisma.doctorProfile.findFirst({
    where: {
      user: {
        isActive: true,
        OR: [
          { username: { equals: clean, mode: 'insensitive' } },
          { username: { equals: under, mode: 'insensitive' } },
          { username: { equals: dash, mode: 'insensitive' } },
        ],
      },
    },
    include: doctorInclude,
  });
  if (byUsername) return byUsername;

  const parts = dash.split('-').filter(Boolean);
  if (parts.length >= 2) {
    const first = parts[0];
    const last = parts.slice(1).join(' ');
    const exactFull = await prisma.doctorProfile.findFirst({
      where: {
        user: {
          isActive: true,
          firstName: { equals: first, mode: 'insensitive' },
          lastName: { equals: last, mode: 'insensitive' },
        },
      },
      include: doctorInclude,
    });
    if (exactFull) return exactFull;

    const partialFull = await prisma.doctorProfile.findFirst({
      where: {
        user: {
          isActive: true,
          firstName: { equals: first, mode: 'insensitive' },
          lastName: { contains: parts[parts.length - 1], mode: 'insensitive' },
        },
      },
      include: doctorInclude,
    });
    if (partialFull) return partialFull;
  }

  const firstMatches = await prisma.doctorProfile.findMany({
    where: { user: { isActive: true, firstName: { equals: clean, mode: 'insensitive' } } },
    include: doctorInclude,
    take: 2,
  });
  if (firstMatches.length === 1) return firstMatches[0];

  const lastMatches = await prisma.doctorProfile.findMany({
    where: { user: { isActive: true, lastName: { equals: clean, mode: 'insensitive' } } },
    include: doctorInclude,
    take: 2,
  });
  if (lastMatches.length === 1) return lastMatches[0];

  return null;
}

export async function doctorDetail(req: Request, res: Response): Promise<void> {
  const doc = await resolveDoctor(req.params.identifier || '');
  if (!doc) throw new HttpError(404, 'Specialist doctor not found.');

  const isStaff = Boolean(req.user && ['doctor', 'receptionist', 'admin'].includes(req.user.role));
  if (!isStaff && !doc.department.isActive) {
    throw new HttpError(404, 'Specialist doctor is currently unavailable.');
  }

  await materializeWeekly(doc, 45);

  const today = localTodayDate();
  const until = addDaysDate(today, 45);
  const now = new Date();

  const slots = await prisma.appointmentSlot.findMany({
    where: {
      doctorId: doc.id,
      date: { gte: today, lte: until },
      isOpen: true,
    },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
  });

  const slotIds = slots.map((s) => s.id);
  const activeCounts = slotIds.length
    ? await prisma.appointment.groupBy({
        by: ['slotId'],
        where: { slotId: { in: slotIds }, status: { in: ACTIVE_APPOINTMENT_STATUSES } },
        _count: { _all: true },
      })
    : [];
  const countMap = new Map<bigint, number>();
  for (const row of activeCounts) {
    countMap.set(row.slotId, row._count._all);
  }

  const upcomingSlots = slots.map((s) => {
    const reserved = countMap.get(s.id) || 0;
    const remaining = Math.max(0, s.capacity - reserved);
    const startUtc = localStartUtc(s.date, s.startTime);
    const bookingOpen = isStaff
      ? remaining > 0 && startUtc > now
      : remaining > 0 &&
        startUtc.getTime() >= now.getTime() + doc.bookingNoticeHours * 3600 * 1000 &&
        startUtc.getTime() <= now.getTime() + doc.bookingAdvanceDays * 86400 * 1000;

    return {
      raw: s,
      reserved,
      remaining,
      bookingOpen,
      serialized: serializeSlot(s, reserved, bookingOpen),
    };
  });

  const weeklySchedules = doc.weekly
    .filter((w) => w.active)
    .map((w) => {
      let match = upcomingSlots.find(
        (u) =>
          pythonWeekday(u.raw.date) === w.weekday &&
          timeToHm(u.raw.startTime) === timeToHm(w.startTime) &&
          u.bookingOpen
      );
      if (!match) {
        match = upcomingSlots.find(
          (u) =>
            pythonWeekday(u.raw.date) === w.weekday &&
            timeToHm(u.raw.startTime) === timeToHm(w.startTime) &&
            u.remaining > 0
        );
      }
      return {
        ...serializeWeekly(w),
        slot: match ? match.serialized : null,
        upcoming_date: match ? dateToIso(match.raw.date) : null,
      };
    });

  res.json({
    doctor: serializeDoctor(doc),
    upcoming_slots: upcomingSlots.map((u) => u.serialized),
    weekly_schedules: weeklySchedules,
    is_staff: isStaff,
    gateway_enabled: gatewayHttpsReady(),
  });
}

// ---------- Single Slot Detail (for BookPage) ----------
export async function getSlotDetail(req: Request, res: Response): Promise<void> {
  if (!/^\d+$/.test(req.params.id)) throw new HttpError(404, 'Slot not found.');
  const slotId = BigInt(req.params.id);
  const slot = await prisma.appointmentSlot.findUnique({
    where: { id: slotId },
    include: { doctor: { include: doctorInclude } },
  });
  if (!slot) throw new HttpError(404, 'Consultation slot not found.');

  const reserved = await prisma.appointment.count({
    where: { slotId: slot.id, status: { in: ACTIVE_APPOINTMENT_STATUSES } },
  });

  res.json({
    slot: serializeSlot(slot, reserved),
    doctor: serializeDoctor(slot.doctor),
    gateway_enabled: gatewayHttpsReady(),
  });
}

// ---------- Staff Slots API (/api/slots/staff & /api/slots) ----------
export async function staffSlotsApi(req: Request, res: Response): Promise<void> {
  const doctorIdRaw = String(req.query.doctor || '');
  const dateRaw = String(req.query.date || '');
  if (!/^\d+$/.test(doctorIdRaw)) {
    res.json({ slots: [] });
    return;
  }
  const doctorId = BigInt(doctorIdRaw);
  const doctor = await prisma.doctorProfile.findUnique({
    where: { id: doctorId },
    include: { user: true },
  });
  if (!doctor || !(await doctorAllowed(req.user!, doctor))) {
    throw new HttpError(404, 'Doctor not found.');
  }
  const day = parseIsoDate(dateRaw);
  if (!day) {
    res.json({ slots: [] });
    return;
  }

  const slots = await prisma.appointmentSlot.findMany({
    where: { doctorId, date: day, isOpen: true },
    orderBy: { startTime: 'asc' },
  });
  const now = new Date();
  const out = [];
  for (const s of slots) {
    if (localStartUtc(s.date, s.startTime) <= now) continue;
    const reserved = await prisma.appointment.count({
      where: { slotId: s.id, status: { in: ACTIVE_APPOINTMENT_STATUSES } },
    });
    const remaining = Math.max(0, s.capacity - reserved);
    if (remaining <= 0) continue;
    out.push({
      id: Number(s.id),
      label: `${timeTo12h(s.startTime)} – ${timeTo12h(s.endTime)}`,
      remaining,
      capacity: s.capacity,
    });
  }
  res.json({ slots: out });
}

export async function openSlots(req: Request, res: Response): Promise<void> {
  const doctorRaw = String(req.query.doctor || '');
  const dateRaw = String(req.query.date || '');
  const where: Prisma.AppointmentSlotWhereInput = { isOpen: true };
  if (/^\d+$/.test(doctorRaw)) where.doctorId = BigInt(doctorRaw);
  const parsedDate = parseIsoDate(dateRaw);
  if (parsedDate) where.date = parsedDate;

  const slots = await prisma.appointmentSlot.findMany({
    where,
    include: { doctor: { include: doctorInclude } },
    orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    take: 300,
  });

  const out = [];
  for (const s of slots) {
    const reserved = await prisma.appointment.count({
      where: { slotId: s.id, status: { in: ACTIVE_APPOINTMENT_STATUSES } },
    });
    if (reserved >= s.capacity) continue;
    out.push(serializeSlot(s, reserved));
  }
  res.json({ slots: out });
}

// ---------- Departments ----------
export async function listDepartments(req: Request, res: Response): Promise<void> {
  const includeInactive =
    req.user?.role === 'admin' || req.query.all === '1' || req.query.all === 'true';

  const items = await prisma.department.findMany({
    where: includeInactive ? {} : { isActive: true },
    orderBy: { name: 'asc' },
    include: {
      doctors: {
        where: { user: { isActive: true } },
        select: { id: true },
      },
    },
  });

  res.json({
    departments: items.map((d) => serializeDepartment({ ...d, docCount: d.doctors.length })),
  });
}

export async function createDepartment(req: Request, res: Response): Promise<void> {
  const name = String(req.body?.name || '').trim();
  const description = String(req.body?.description || '').trim().slice(0, 255);
  const icon = String(req.body?.icon || 'heart-pulse').trim().slice(0, 32);

  if (!name) throw new HttpError(400, 'Department name is required.');
  const existing = await prisma.department.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
  });
  if (existing) throw new HttpError(400, `Department "${name}" already exists.`);

  const dept = await prisma.department.create({
    data: { name, slug: slugify(name), description, icon, isActive: true },
  });
  await logAudit(req.user, 'department.created', Number(dept.id), dept.name);
  res.status(201).json({
    department: serializeDepartment(dept),
    message: `Department "${dept.name}" created successfully.`,
  });
}

export async function updateDepartment(req: Request, res: Response): Promise<void> {
  const id = BigInt(req.params.id);
  const dept = await prisma.department.findUnique({ where: { id } });
  if (!dept) throw new HttpError(404, 'Department not found.');

  const name = String(req.body?.name || '').trim();
  const description = String(req.body?.description || '').trim().slice(0, 255);
  if (!name) throw new HttpError(400, 'Department name is required.');

  const dup = await prisma.department.findFirst({
    where: { NOT: { id }, name: { equals: name, mode: 'insensitive' } },
  });
  if (dup) throw new HttpError(400, `Department "${name}" already exists.`);

  const updated = await prisma.department.update({
    where: { id },
    data: { name, slug: slugify(name), description },
  });
  await logAudit(req.user, 'department.updated', Number(updated.id), updated.name);
  res.json({
    department: serializeDepartment(updated),
    message: `Department "${updated.name}" updated successfully.`,
  });
}

export async function toggleDepartmentStatus(req: Request, res: Response): Promise<void> {
  const id = BigInt(req.params.id);
  const dept = await prisma.department.findUnique({ where: { id } });
  if (!dept) throw new HttpError(404, 'Department not found.');

  if (dept.isActive) {
    const openCount = await prisma.appointment.count({
      where: {
        slot: { doctor: { departmentId: id } },
        status: { in: ['pending', 'confirmed'] },
      },
    });
    if (openCount > 0) {
      throw new HttpError(
        400,
        `Cannot deactivate department "${dept.name}": There are ${openCount} open appointment(s) scheduled for doctors in this department.`
      );
    }
  }

  const updated = await prisma.department.update({
    where: { id },
    data: { isActive: !dept.isActive },
  });
  await logAudit(
    req.user,
    updated.isActive ? 'department.activated' : 'department.deactivated',
    Number(updated.id),
    updated.name
  );
  res.json({
    department: serializeDepartment(updated),
    message: `Department "${updated.name}" ${updated.isActive ? 'activated' : 'deactivated'} successfully.`,
  });
}

// ---------- Chambers / Consultation Rooms ----------
export async function listChambers(req: Request, res: Response): Promise<void> {
  const q = String(req.query.q || '').trim();
  const items = await prisma.chamber.findMany({
    where: q
      ? {
          OR: [
            { roomNumber: { contains: q, mode: 'insensitive' } },
            { description: { contains: q, mode: 'insensitive' } },
            { building: { contains: q, mode: 'insensitive' } },
            { name: { contains: q, mode: 'insensitive' } },
          ],
        }
      : {},
    include: {
      department: true,
      doctors: {
        include: { user: true, weekly: true },
      },
    },
    orderBy: [{ roomNumber: 'asc' }, { building: 'asc' }],
  });

  res.json({
    chambers: items.map(serializeChamber),
    total_count: await prisma.chamber.count(),
  });
}

export async function createChamber(req: Request, res: Response): Promise<void> {
  const roomNumber = String(req.body?.room_number || '').trim();
  if (!roomNumber) throw new HttpError(400, 'Room Number is required.');

  const building = String(req.body?.building || 'Building 1').trim() || 'Building 1';
  const description = String(req.body?.description || '').trim().slice(0, 255);
  const floor = String(req.body?.floor || '1st Floor').trim();
  const name = String(req.body?.name || roomNumber).trim() || roomNumber;
  const address = String(req.body?.address || 'Mirpur, Dhaka').trim();
  const contactNumber = String(req.body?.contact_number || '+88096100016211').trim();

  const chamber = await prisma.chamber.create({
    data: {
      building,
      name,
      roomNumber,
      floor,
      description,
      address,
      contactNumber,
      isActive: true,
    },
  });

  await logAudit(req.user, 'room.add', Number(chamber.id), chamber.roomNumber);
  res.status(201).json({
    chamber: serializeChamber(chamber),
    message: `Consultation Room "${chamber.roomNumber}" added successfully.`,
  });
}

export async function updateChamber(req: Request, res: Response): Promise<void> {
  const id = BigInt(req.params.id);
  const existing = await prisma.chamber.findUnique({ where: { id } });
  if (!existing) throw new HttpError(404, 'Consultation room not found.');

  const roomNumber = String(req.body?.room_number ?? existing.roomNumber).trim();
  if (!roomNumber) throw new HttpError(400, 'Room Number is required.');

  const description = String(req.body?.description ?? existing.description).trim().slice(0, 255);
  const updated = await prisma.chamber.update({
    where: { id },
    data: {
      roomNumber,
      description,
      building: existing.building || 'Building 1',
      name: existing.name || roomNumber,
      address: 'Mirpur, Dhaka',
      contactNumber: '+88096100016211',
      isActive: true,
    },
  });

  await prisma.doctorProfile.updateMany({
    where: { chamberId: id },
    data: { roomNumber: updated.roomNumber },
  });

  await logAudit(req.user, 'room.edit', Number(updated.id), updated.roomNumber);
  res.json({
    chamber: serializeChamber(updated),
    message: `Consultation Room "${updated.roomNumber}" updated successfully.`,
  });
}

export async function deleteChamber(req: Request, res: Response): Promise<void> {
  const id = BigInt(req.params.id);
  const chamber = await prisma.chamber.findUnique({ where: { id } });
  if (!chamber) throw new HttpError(404, 'Consultation room not found.');

  await prisma.$transaction(async (tx) => {
    await tx.doctorProfile.updateMany({
      where: { chamberId: id },
      data: { chamberId: null, roomNumber: '' },
    });
    await tx.chamber.delete({ where: { id } });
    await logAudit(req.user, 'room.deleted', Number(id), chamber.roomNumber, tx);
  });

  res.json({ message: `Consultation Room "${chamber.roomNumber}" deleted successfully.` });
}

// ---------- Schedules & Slots ----------
export async function getSchedule(req: Request, res: Response): Promise<void> {
  const docIds = await managedDoctorIds(req.user!);
  const docs = await prisma.doctorProfile.findMany({
    where: docIds === null ? {} : { id: { in: docIds } },
    include: doctorInclude,
    orderBy: [{ user: { firstName: 'asc' } }, { user: { lastName: 'asc' } }],
  });

  const requestedDocId = /^\d+$/.test(String(req.query.doctor || ''))
    ? BigInt(String(req.query.doctor))
    : null;
  const selectedDoc =
    req.user!.role === 'doctor'
      ? docs[0] || null
      : (requestedDocId && docs.find((d) => d.id === requestedDocId)) || docs[0] || null;

  const dateStr = String(req.query.date || '').trim() || dateToIso(localTodayDate());
  const dateObj = parseIsoDate(dateStr) || localTodayDate();

  const [patterns, slots] = selectedDoc
    ? await Promise.all([
        prisma.weeklyAvailability.findMany({
          where: { doctorId: selectedDoc.id },
          orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
        }),
        prisma.appointmentSlot.findMany({
          where: { doctorId: selectedDoc.id, date: dateObj },
          orderBy: { startTime: 'asc' },
        }),
      ])
    : [[], []];

  const slotIds = slots.map((s) => s.id);
  const activeCounts = slotIds.length
    ? await prisma.appointment.groupBy({
        by: ['slotId'],
        where: { slotId: { in: slotIds }, status: { in: ACTIVE_APPOINTMENT_STATUSES } },
        _count: { _all: true },
      })
    : [];
  const countMap = new Map<bigint, number>(activeCounts.map((r) => [r.slotId, r._count._all]));

  res.json({
    doctor: selectedDoc ? serializeDoctor(selectedDoc) : null,
    doctors: docs.map(serializeDoctor),
    patterns: patterns.map(serializeWeekly),
    slots: slots.map((s) => serializeSlot(s, countMap.get(s.id) || 0)),
    date_value: dateToIso(dateObj),
    can_edit: ['doctor', 'admin'].includes(req.user!.role),
  });
}

export async function saveWeekly(req: Request, res: Response): Promise<void> {
  const doctorId = BigInt(req.params.doctorPk);
  const doctor = await prisma.doctorProfile.findUnique({ where: { id: doctorId } });
  if (!doctor || !(await doctorAllowed(req.user!, doctor))) {
    throw new HttpError(403, 'Not authorized for this doctor.');
  }

  const weekday = Number(req.body?.weekday);
  const startTime = parseTimeStr(String(req.body?.start_time || ''));
  const endTime = parseTimeStr(String(req.body?.end_time || ''));
  const durationMinutes = Number(req.body?.duration_minutes ?? 30);
  const capacity = Number(req.body?.capacity ?? 1);
  const active = req.body?.active !== undefined ? Boolean(req.body.active) : true;

  if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
    throw new HttpError(400, 'Select a valid weekday.');
  }
  if (!startTime || !endTime) {
    throw new HttpError(400, 'Valid start and end times are required.');
  }
  if (timeToHm(endTime) <= timeToHm(startTime)) {
    throw new HttpError(400, 'End time must be later than start time.');
  }
  if (durationMinutes < 5 || durationMinutes > 240) {
    throw new HttpError(400, 'Duration must be between 5 and 240 minutes.');
  }
  if (capacity < 1 || capacity > 100) {
    throw new HttpError(400, 'Capacity must be between 1 and 100.');
  }

  const weeklyId = req.params.id && /^\d+$/.test(req.params.id) ? BigInt(req.params.id) : null;
  const result = await prisma.$transaction(async (tx) => {
    let saved;
    if (weeklyId) {
      const existing = await tx.weeklyAvailability.findFirst({
        where: { id: weeklyId, doctorId: doctor.id },
      });
      if (!existing) throw new HttpError(404, 'Weekly schedule pattern not found.');
      saved = await tx.weeklyAvailability.update({
        where: { id: weeklyId },
        data: { weekday, startTime, endTime, durationMinutes, capacity, active },
      });

      const today = localTodayDate();
      const futureSlots = await tx.appointmentSlot.findMany({
        where: { templateId: saved.id, date: { gte: today } },
        include: {
          appointments: {
            where: { status: { notIn: ['cancelled', 'expired'] } },
            select: { id: true },
          },
        },
      });
      for (const s of futureSlots) {
        if (s.isOpen && s.appointments.length === 0) {
          await tx.appointmentSlot.delete({ where: { id: s.id } });
        }
      }
    } else {
      saved = await tx.weeklyAvailability.create({
        data: {
          doctorId: doctor.id,
          weekday,
          startTime,
          endTime,
          durationMinutes,
          capacity,
          active,
        },
      });
    }

    const published = await materializeWeekly(doctor, 60, tx);
    await logAudit(
      req.user,
      'schedule.updated',
      Number(doctor.id),
      `${saved.id}; published=${published}`,
      tx
    );
    return { saved, published };
  });

  res.status(weeklyId ? 200 : 201).json({
    weekly: serializeWeekly(result.saved),
    published: result.published,
    message: `Weekly schedule saved. ${result.published} upcoming time slots published.`,
  });
}

export async function deleteWeekly(req: Request, res: Response): Promise<void> {
  const id = BigInt(req.params.id);
  const obj = await prisma.weeklyAvailability.findUnique({
    where: { id },
    include: { doctor: true },
  });
  if (!obj) throw new HttpError(404, 'Weekly schedule not found.');
  if (!(await doctorAllowed(req.user!, obj.doctor))) {
    throw new HttpError(403, 'Not authorized.');
  }

  await prisma.$transaction(async (tx) => {
    const today = localTodayDate();
    const slots = await tx.appointmentSlot.findMany({
      where: { templateId: obj.id, date: { gte: today } },
      include: {
        appointments: {
          where: { status: { notIn: ['cancelled', 'expired'] } },
          select: { id: true },
        },
      },
    });
    for (const s of slots) {
      if (s.appointments.length > 0) {
        await tx.appointmentSlot.update({ where: { id: s.id }, data: { isOpen: false } });
      } else {
        await tx.appointmentSlot.delete({ where: { id: s.id } });
      }
    }
    await tx.weeklyAvailability.delete({ where: { id: obj.id } });
    await logAudit(req.user, 'schedule.weekly_removed', Number(id), '', tx);
  });

  res.json({
    message: 'Recurring schedule removed. Existing bookings were retained and their slots closed.',
  });
}

export async function saveSlot(req: Request, res: Response): Promise<void> {
  const slotId = req.params.id && /^\d+$/.test(req.params.id) ? BigInt(req.params.id) : null;
  const existing = slotId
    ? await prisma.appointmentSlot.findUnique({
        where: { id: slotId },
        include: { doctor: true },
      })
    : null;
  if (slotId && !existing) throw new HttpError(404, 'Slot not found.');
  if (existing && !(await doctorAllowed(req.user!, existing.doctor))) {
    throw new HttpError(403, 'Not authorized.');
  }

  const doctorId = BigInt(req.body?.doctor_id ?? req.body?.doctor ?? existing?.doctorId ?? 0);
  const doctor = await prisma.doctorProfile.findUnique({ where: { id: doctorId } });
  if (!doctor || !(await doctorAllowed(req.user!, doctor))) {
    throw new HttpError(403, 'Not authorized for this doctor.');
  }

  const dateObj = parseIsoDate(String(req.body?.date || ''));
  const startTime = parseTimeStr(String(req.body?.start_time || ''));
  const endTime = parseTimeStr(String(req.body?.end_time || ''));
  const capacity = Number(req.body?.capacity ?? 1);
  const isOpen = req.body?.is_open !== undefined ? Boolean(req.body.is_open) : true;

  if (!dateObj) throw new HttpError(400, 'Select a valid date (YYYY-MM-DD).');
  if (dateObj < localTodayDate()) throw new HttpError(400, 'Select today or a future date.');
  if (!startTime || !endTime) throw new HttpError(400, 'Start and end times are required.');
  if (timeToHm(endTime) <= timeToHm(startTime)) {
    throw new HttpError(400, 'End must be later than start.');
  }
  if (capacity < 1 || capacity > 150) {
    throw new HttpError(400, 'Capacity must be between 1 and 150.');
  }

  if (existing) {
    const reserved = await prisma.appointment.count({
      where: { slotId: existing.id, status: { notIn: ['cancelled', 'expired'] } },
    });
    if (capacity < reserved) {
      throw new HttpError(400, 'Capacity cannot be smaller than existing appointments.');
    }
    if (
      reserved > 0 &&
      (doctor.id !== existing.doctorId ||
        dateToIso(dateObj) !== dateToIso(existing.date) ||
        timeToHm(startTime) !== timeToHm(existing.startTime))
    ) {
      throw new HttpError(
        400,
        'A booked slot cannot be moved. Cancel affected appointments first.'
      );
    }
  }

  const conflict = await prisma.appointmentSlot.findFirst({
    where: {
      ...(existing ? { NOT: { id: existing.id } } : {}),
      doctorId: doctor.id,
      date: dateObj,
      startTime,
    },
  });
  if (conflict) {
    throw new HttpError(400, 'This doctor already has a slot at that time.');
  }

  const saved = existing
    ? await prisma.appointmentSlot.update({
        where: { id: existing.id },
        data: { doctorId: doctor.id, date: dateObj, startTime, endTime, capacity, isOpen },
      })
    : await prisma.appointmentSlot.create({
        data: { doctorId: doctor.id, date: dateObj, startTime, endTime, capacity, isOpen },
      });

  await logAudit(req.user, 'slot.saved', Number(saved.id));
  const reserved = await prisma.appointment.count({
    where: { slotId: saved.id, status: { in: ACTIVE_APPOINTMENT_STATUSES } },
  });
  res.status(existing ? 200 : 201).json({
    slot: serializeSlot(saved, reserved),
    message: 'Appointment time slot saved.',
  });
}

export async function toggleSlot(req: Request, res: Response): Promise<void> {
  const id = BigInt(req.params.id);
  const slot = await prisma.appointmentSlot.findUnique({
    where: { id },
    include: { doctor: true },
  });
  if (!slot) throw new HttpError(404, 'Slot not found.');
  if (!(await doctorAllowed(req.user!, slot.doctor))) {
    throw new HttpError(403, 'Not authorized.');
  }
  const updated = await prisma.appointmentSlot.update({
    where: { id },
    data: { isOpen: !slot.isOpen },
  });
  await logAudit(req.user, 'slot.open_changed', Number(id), String(updated.isOpen));
  res.json({
    slot: serializeSlot(updated),
    message: 'Slot availability updated. Existing bookings remain unchanged.',
  });
}

export async function copySlots(req: Request, res: Response): Promise<void> {
  const doctorId = BigInt(req.body?.doctor_id ?? req.body?.doctor ?? 0);
  const doctor = await prisma.doctorProfile.findUnique({ where: { id: doctorId } });
  if (!doctor || !(await doctorAllowed(req.user!, doctor))) {
    throw new HttpError(403, 'Not authorized for this doctor.');
  }

  const fromDate = parseIsoDate(String(req.body?.from_date || ''));
  const toDate = parseIsoDate(String(req.body?.to_date || ''));
  const today = localTodayDate();
  const maxDate = addDaysDate(today, 180);

  if (!fromDate || !toDate || toDate < today || toDate > maxDate) {
    throw new HttpError(400, 'Select a valid source date and a future destination date.');
  }

  const sourceSlots = await prisma.appointmentSlot.findMany({
    where: { doctorId: doctor.id, date: fromDate },
  });
  let made = 0;
  for (const s of sourceSlots) {
    const exists = await prisma.appointmentSlot.findUnique({
      where: {
        doctorId_date_startTime: {
          doctorId: doctor.id,
          date: toDate,
          startTime: s.startTime,
        },
      },
      select: { id: true },
    });
    if (!exists) {
      await prisma.appointmentSlot.create({
        data: {
          doctorId: doctor.id,
          date: toDate,
          startTime: s.startTime,
          endTime: s.endTime,
          capacity: s.capacity,
          isOpen: s.isOpen,
        },
      });
      made++;
    }
  }

  await logAudit(
    req.user,
    'schedule.copied',
    Number(doctor.id),
    `${dateToIso(fromDate)} → ${dateToIso(toDate)}; ${made} new slots`
  );
  res.json({
    created_count: made,
    to_date: dateToIso(toDate),
    message: `${made} new time slots copied. Existing appointments were not changed.`,
  });
}

export { userDisplayName };
