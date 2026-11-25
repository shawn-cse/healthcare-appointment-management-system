import type { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import { HttpError } from '../middleware/error.js';
import { dateToIso, timeTo12h, timeToHm, WEEKDAY_NAMES } from '../utils/dateTime.js';

type DbClient = Prisma.TransactionClient | typeof prisma;

export interface WeeklyWindow {
  weekday: number;
  startTime: Date;
  endTime: Date;
}

/** Ensures a doctor's weekly rules in a room do not overlap any other active doctor in the same room. */
export async function assertNoRoomWeeklyConflict(
  db: DbClient,
  opts: {
    chamberId: bigint | null | undefined;
    excludeDoctorId?: bigint;
    rules: WeeklyWindow[];
  }
): Promise<void> {
  if (!opts.chamberId || opts.rules.length === 0) return;

  const existing = await db.weeklyAvailability.findMany({
    where: {
      active: true,
      doctor: {
        chamberId: opts.chamberId,
        user: { isActive: true },
        ...(opts.excludeDoctorId ? { id: { not: opts.excludeDoctorId } } : {}),
      },
    },
    include: {
      doctor: { include: { user: true, chamber: true } },
    },
  });

  for (const cand of opts.rules) {
    const cStart = timeToHm(cand.startTime);
    const cEnd = timeToHm(cand.endTime);
    for (const row of existing) {
      if (row.weekday !== cand.weekday) continue;
      const eStart = timeToHm(row.startTime);
      const eEnd = timeToHm(row.endTime);
      if (cStart < eEnd && cEnd > eStart) {
        const docName =
          `${row.doctor.user.firstName || ''} ${row.doctor.user.lastName || ''}`.trim() ||
          row.doctor.user.username;
        const roomLbl = row.doctor.chamber?.roomNumber || row.doctor.roomNumber || 'this room';
        throw new HttpError(
          400,
          `Schedule conflict in ${roomLbl}: Dr. ${docName} is already scheduled on ${WEEKDAY_NAMES[cand.weekday]} (${timeTo12h(row.startTime)} – ${timeTo12h(row.endTime)}).`
        );
      }
    }
  }
}

/** Ensures a single-date custom consultation slot does not overlap another active doctor in the same room. */
export async function assertNoRoomSlotConflict(
  db: DbClient,
  opts: {
    chamberId: bigint | null | undefined;
    excludeDoctorId?: bigint;
    excludeSlotId?: bigint;
    date: Date;
    startTime: Date;
    endTime: Date;
  }
): Promise<void> {
  if (!opts.chamberId) return;

  const existing = await db.appointmentSlot.findMany({
    where: {
      date: opts.date,
      isOpen: true,
      ...(opts.excludeSlotId ? { id: { not: opts.excludeSlotId } } : {}),
      doctor: {
        chamberId: opts.chamberId,
        user: { isActive: true },
        ...(opts.excludeDoctorId ? { id: { not: opts.excludeDoctorId } } : {}),
      },
    },
    include: {
      doctor: { include: { user: true, chamber: true } },
    },
  });

  const cStart = timeToHm(opts.startTime);
  const cEnd = timeToHm(opts.endTime);
  for (const row of existing) {
    const eStart = timeToHm(row.startTime);
    const eEnd = timeToHm(row.endTime);
    if (cStart < eEnd && cEnd > eStart) {
      const docName =
        `${row.doctor.user.firstName || ''} ${row.doctor.user.lastName || ''}`.trim() ||
        row.doctor.user.username;
      const roomLbl = row.doctor.chamber?.roomNumber || row.doctor.roomNumber || 'this room';
      throw new HttpError(
        400,
        `Room conflict in ${roomLbl} on ${dateToIso(opts.date)}: Dr. ${docName} already has a slot (${timeTo12h(row.startTime)} – ${timeTo12h(row.endTime)}).`
      );
    }
  }
}
