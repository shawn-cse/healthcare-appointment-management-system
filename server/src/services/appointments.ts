import crypto from 'node:crypto';
import type { Prisma, PrismaClient, User } from '@prisma/client';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { HttpError } from '../middleware/error.js';
import {
  addDaysDate,
  dateToIso,
  localStartUtc,
  localTodayDate,
  parseTimeStr,
  pythonWeekday,
  timeToHm,
} from '../utils/dateTime.js';
import { doctorAllowed } from './access.js';
import { logAudit } from './audit.js';
import { userDisplayName } from './serialize.js';

export const ACTIVE_APPOINTMENT_STATUSES = ['pending', 'confirmed', 'completed', 'no_show'];

export function acceptsPayment(methods: string, method: string): boolean {
  return ['cash', 'online'].includes(method) && methods.split(',').includes(method);
}

export function bookingHorizonDays(doctor: { bookingWindowHours: number | null; bookingAdvanceDays: number }): number {
  return Math.min(180, Math.max(1, Math.ceil((doctor.bookingWindowHours ?? doctor.bookingAdvanceDays * 24) / 24)));
}

type DbClient = PrismaClient | Prisma.TransactionClient;

export function round2(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

export function calcHospitalCut(
  doctor: { hospitalShareMode: string; hospitalShareValue: unknown },
  fee: number
): number {
  const shareVal = Number(doctor.hospitalShareValue);
  if (doctor.hospitalShareMode === 'monthly') return 0;
  if (doctor.hospitalShareMode === 'fixed') {
    return round2(Math.min(fee, shareVal));
  }
  return round2(Math.min(fee, round2((fee * shareVal) / 100)));
}

/** Bookings snapshot the monthly limit. Actual monthly deductions are posted when payments settle. */
export async function settleMonthlyCommission(
  tx: Prisma.TransactionClient,
  appointment: { commissionMode: string | null; commissionValue: unknown; fee: unknown },
  doctorId: bigint,
  paidAt: Date
) {
  if (appointment.commissionMode !== 'monthly') return {};
  const firstDay = localTodayDate(paidAt);
  firstDay.setUTCDate(1);
  const nextMonth = new Date(firstDay);
  nextMonth.setUTCMonth(nextMonth.getUTCMonth() + 1);
  const midnight = parseTimeStr('00:00')!;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`monthly-commission:${doctorId}:${dateToIso(firstDay)}`}, 0))`;
  const payments = await tx.paymentTransaction.findMany({
    where: { kind: 'charge', status: 'verified', processedAt: { gte: localStartUtc(firstDay, midnight), lt: localStartUtc(nextMonth, midnight) },
      appointment: { commissionMode: 'monthly', slot: { doctorId } } },
    select: { appointment: { select: { hospitalCut: true, fee: true, payments: { where: { kind: 'refund', status: 'refunded', processedAt: { lte: paidAt } }, select: { amount: true } } } } },
  });
  const alreadyDeducted = payments.reduce((sum, { appointment: row }) => {
    const refunded = row.payments.reduce((total, refund) => total + Number(refund.amount), 0);
    const fee = Number(row.fee);
    return sum + (fee > 0 ? round2(Number(row.hospitalCut) * Math.max(0, fee - refunded) / fee) : 0);
  }, 0);
  const fee = Number(appointment.fee);
  const hospitalCut = round2(Math.min(fee, Math.max(0, Number(appointment.commissionValue) - alreadyDeducted)));
  return { hospitalCut, doctorCut: round2(fee - hospitalCut) };
}

export async function generateUniqueReference(db: DbClient = prisma): Promise<string> {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  for (;;) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[crypto.randomInt(chars.length)];
    }
    const exists = await db.appointment.findFirst({
      where: { reference: { equals: code, mode: 'insensitive' } },
      select: { id: true },
    });
    if (!exists) return code;
  }
}

export async function generateUniqueTicketCode(db: DbClient = prisma): Promise<string> {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  for (;;) {
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[crypto.randomInt(chars.length)];
    }
    if (!/[A-Z]/.test(code) || !/[0-9]/.test(code)) continue;
    const exists = await db.complaint.findFirst({
      where: { ticketCode: { equals: code, mode: 'insensitive' } },
      select: { id: true },
    });
    if (!exists) return code;
  }
}

/** Publish recurring availability; one consultation session per clinic day with full capacity. */
export async function materializeWeekly(
  doctor: { id: bigint; maxPatientsPerSession: number },
  days = 60,
  db: DbClient = prisma
): Promise<number> {
  const patterns = await db.weeklyAvailability.findMany({
    where: { doctorId: doctor.id, active: true },
    orderBy: [{ weekday: 'asc' }, { startTime: 'asc' }],
  });
  if (!patterns.length) return 0;

  const today = localTodayDate();
  const cappedDays = Math.min(days, 180);
  const until = addDaysDate(today, cappedDays);

  const existingSlots = await db.appointmentSlot.findMany({
    where: {
      doctorId: doctor.id,
      date: { gte: today, lte: until },
    },
    select: { date: true, startTime: true },
  });
  const existingKeys = new Set(
    existingSlots.map((s) => `${dateToIso(s.date)}|${timeToHm(s.startTime)}`)
  );

  const sessionCapacity = doctor.maxPatientsPerSession || 30;
  const pending: Prisma.AppointmentSlotCreateManyInput[] = [];

  for (let dayN = 0; dayN <= cappedDays; dayN++) {
    const day = addDaysDate(today, dayN);
    const wd = pythonWeekday(day);
    for (const pattern of patterns) {
      if (wd !== pattern.weekday) continue;
      const key = `${dateToIso(day)}|${timeToHm(pattern.startTime)}`;
      if (existingKeys.has(key)) continue;
      const cap = pattern.capacity > 2 ? pattern.capacity : sessionCapacity;
      pending.push({
        doctorId: doctor.id,
        templateId: pattern.id,
        date: day,
        startTime: pattern.startTime,
        endTime: pattern.endTime,
        capacity: cap,
        isOpen: true,
      });
      existingKeys.add(key);
    }
  }

  if (pending.length) {
    const result = await db.appointmentSlot.createMany({
      data: pending,
      skipDuplicates: true,
    });
    return result.count;
  }
  return 0;
}

export function validateSlotForBooking(
  slot: {
    date: Date;
    startTime: Date;
    isOpen: boolean;
    doctor: {
      isAvailable: boolean;
      bookingNoticeHours: number;
      bookingAdvanceDays: number;
      bookingWindowHours?: number | null;
      paymentDeadlineHours?: number;
      paymentPolicy?: string;
      department?: { isActive: boolean } | null;
      chamber?: { isActive: boolean } | null;
      user: { isActive: boolean };
    };
  },
  isStaffBooking = false
): void {
  const now = new Date();
  const start = localStartUtc(slot.date, slot.startTime);
  const profile = slot.doctor;

  if (!slot.isOpen || !profile.isAvailable || !profile.user.isActive || profile.department?.isActive === false || profile.chamber?.isActive === false || start <= now) {
    throw new HttpError(400, 'This consultation session is no longer open for booking.');
  }

  if (profile.bookingWindowHours != null) {
    const hoursUntilStart = (start.getTime() - now.getTime()) / 3_600_000;
    if (hoursUntilStart > profile.bookingWindowHours) throw new HttpError(400, `Booking opens ${profile.bookingWindowHours} hours before consultation.`);
    if (profile.paymentPolicy === 'within' && hoursUntilStart <= (profile.paymentDeadlineHours ?? 0)) {
      throw new HttpError(400, 'The payment deadline for this consultation has passed.');
    }
  } else if (!isStaffBooking) {
    const noticeMs = profile.bookingNoticeHours * 3600 * 1000;
    if (start.getTime() < now.getTime() + noticeMs) {
      const hours = profile.bookingNoticeHours;
      let timeStr: string;
      if (hours >= 24 && hours % 24 === 0) {
        const days = Math.floor(hours / 24);
        timeStr = `${days} day${days > 1 ? 's' : ''}`;
      } else {
        timeStr = `${hours} hours`;
      }
      throw new HttpError(
        400,
        `Online booking for this session is closed. This doctor requires at least ${timeStr} advance notice. For urgent consultations or today’s serials, please contact the hospital helpline at ${env.hospitalPhone}.`
      );
    }
    const maxMs = profile.bookingAdvanceDays * 86400 * 1000;
    if (start.getTime() > now.getTime() + maxMs) {
      throw new HttpError(
        400,
        `Appointments can be booked up to ${profile.bookingAdvanceDays} days ahead.`
      );
    }
  }
}

export async function followupEligible(
  doctor: { id: bigint; followupWithinDays: number },
  opts: { patient?: Pick<User, 'id' | 'phone'> | null; phone?: string; appointmentDate?: Date },
  db: DbClient = prisma
): Promise<boolean> {
  const end = opts.appointmentDate || localTodayDate();
  const start = addDaysDate(end, -doctor.followupWithinDays);

  const identityFilter: Prisma.AppointmentWhereInput[] = [];
  if (opts.patient) {
    identityFilter.push({ patientId: opts.patient.id });
  }

  if (!identityFilter.length) return false;

  const prior = await db.appointment.findFirst({
    where: {
      status: 'completed',
      slot: {
        doctorId: doctor.id,
        date: { gte: start, lte: end },
      },
      OR: identityFilter,
    },
    select: { id: true },
  });
  return Boolean(prior);
}

export async function feeFor(
  doctor: {
    id: bigint;
    initialFee: unknown;
    followupFee: unknown;
    followupWithinDays: number;
    reportFee: unknown;
    reportWithinDays?: number;
  },
  visitType: string,
  opts: { patient?: Pick<User, 'id' | 'phone'> | null; phone?: string; appointmentDate?: Date },
  db: DbClient = prisma
): Promise<number> {
  if (visitType === 'followup' || visitType === 'report') {
    const days = visitType === 'report' ? doctor.reportWithinDays ?? doctor.followupWithinDays : doctor.followupWithinDays;
    const ok = await followupEligible({ id: doctor.id, followupWithinDays: days }, opts, db);
    if (!ok) {
      throw new HttpError(
        400,
        'This visit type requires a completed visit with this doctor within the eligible period.'
      );
    }
    return Number(visitType === 'report' ? doctor.reportFee : doctor.followupFee);
  }
  if (visitType !== 'first') {
    throw new HttpError(400, 'Select a valid consultation type.');
  }
  return Number(doctor.initialFee);
}

export interface CreateAppointmentInput {
  actor: User;
  slotId: bigint;
  patientId?: bigint | null;
  name?: string;
  phone?: string;
  dob?: Date | null;
  age?: number | null;
  gender?: string | null;
  identityVerified?: boolean;
  visitType?: string;
  source?: string;
  paymentMethod?: string;
  notes?: string;
  collectCash?: boolean;
  cashNote?: string;
}

export async function createAppointment(input: CreateAppointmentInput) {
  return prisma.$transaction(async (tx) => {
    const slotId = input.slotId;
    const locked = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM hospital_appointmentslot WHERE id = ${slotId} FOR UPDATE
    `;
    if (!locked.length) {
      throw new HttpError(404, 'Consultation session not found.');
    }

    const slot = await tx.appointmentSlot.findUnique({
      where: { id: slotId },
      include: {
        doctor: {
          include: {
            user: true,
            department: true,
            chamber: true,
          },
        },
      },
    });
    if (!slot) throw new HttpError(404, 'Consultation session not found.');

    const actor = input.actor;
    if (!actor.isActive || !['admin', 'receptionist', 'patient'].includes(actor.role)) throw new HttpError(403, 'Not authorized to book appointments.');
    let patientObj: User | null = null;
    let name = (input.name || '').trim();
    let phone = (input.phone || '').trim();
    let dob = input.dob ?? null;
    const source = input.source || (actor.role === 'patient' ? 'web' : 'desk');
    const visitType = input.visitType || 'first';
    const paymentMethod = input.paymentMethod || 'cash';
    if (!acceptsPayment(slot.doctor.acceptedPaymentMethods, paymentMethod)) throw new HttpError(400, 'Select an accepted payment method.');

    if (actor.role === 'patient') {
      if (
        (input.patientId !== undefined && input.patientId !== null && input.patientId !== actor.id) ||
        source !== 'web'
      ) {
        throw new HttpError(403, 'Patients can book only for their own account.');
      }
      patientObj = actor;
      name = userDisplayName(actor);
      phone = actor.phone || '';
      dob = actor.dob;
    } else {
      const allowed = await doctorAllowed(actor, slot.doctor, tx);
      if (!allowed) {
        throw new HttpError(403, 'You are not assigned to this doctor.');
      }
      if (input.patientId) {
        patientObj = await tx.user.findFirst({
          where: { id: input.patientId, role: 'patient', isActive: true },
        });
        if (!patientObj) {
          throw new HttpError(400, 'Selected patient account was not found.');
        }
        if (!input.identityVerified || phone !== patientObj.phone) throw new HttpError(400, 'Confirm identity and use the account phone to link this booking.');
      }
    }

    if (!name || !phone) {
      throw new HttpError(400, 'Patient name and phone are required.');
    }

    validateSlotForBooking(slot, actor.role !== 'patient');

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`booking:${phone}`}, 0))`;
    {
      const duplicate = await tx.appointment.findFirst({
        where: {
          ...(patientObj ? { OR: [{ patientId: patientObj.id }, { patientId: null, guestPhone: phone }] } : { guestPhone: phone }),
          status: { in: ACTIVE_APPOINTMENT_STATUSES },
          slot: {
            date: slot.date,
            startTime: slot.startTime,
          },
        },
        select: { id: true },
      });
      if (duplicate) {
        throw new HttpError(400, 'You already have an appointment at this time.');
      }
    }

    const activeCount = await tx.appointment.count({
      where: {
        slotId: slot.id,
        status: { in: ACTIVE_APPOINTMENT_STATUSES },
      },
    });
    if (activeCount >= slot.capacity) {
      throw new HttpError(
        400,
        `All ${slot.capacity} serials for this consultation session have been booked.`
      );
    }

    const latest = await tx.appointment.aggregate({ where: { slotId: slot.id }, _max: { serialNumber: true } });
    const serialNumber = (latest._max.serialNumber ?? 0) + 1;
    const fee = await feeFor(
      slot.doctor,
      visitType,
      { patient: patientObj, phone, appointmentDate: slot.date },
      tx
    );
    const hospitalCut = calcHospitalCut(slot.doctor, fee);
    const doctorCut = round2(fee - hospitalCut);

    const within = slot.doctor.paymentPolicy === 'within';
    let paymentDueAt: Date | null = null;
    if (within) {
      const deadline = new Date(Date.now() + slot.doctor.paymentDeadlineHours * 3600 * 1000);
      const startUtc = localStartUtc(slot.date, slot.startTime);
      paymentDueAt = slot.doctor.bookingWindowHours != null
        ? new Date(startUtc.getTime() - slot.doctor.paymentDeadlineHours * 3_600_000)
        : new Date(Math.min(deadline.getTime(), startUtc.getTime()));
    }

    const reference = await generateUniqueReference(tx);
    const created = await tx.appointment.create({
      data: {
        reference,
        serialNumber,
        slotId: slot.id,
        patientId: patientObj ? patientObj.id : null,
        guestName: name,
        guestPhone: phone,
        guestDob: dob,
        guestAge: input.age ?? null,
        guestGender: input.gender ?? patientObj?.gender ?? null,
        visitType,
        status: within ? 'pending' : 'confirmed',
        paymentStatus: 'unpaid',
        paymentMethod,
        acceptedPaymentMethods: slot.doctor.acceptedPaymentMethods,
        commissionMode: slot.doctor.hospitalShareMode,
        commissionValue: slot.doctor.hospitalShareValue,
        paymentDeadlineHours: slot.doctor.bookingWindowHours != null && within ? slot.doctor.paymentDeadlineHours : null,
        source,
        fee,
        hospitalCut,
        doctorCut,
        cancelModeSnapshot: slot.doctor.cancelFeeMode,
        cancelValueSnapshot: slot.doctor.cancelFeeValue,
        paymentDueAt,
        notes: (input.notes || '').trim(),
        cancellationReason: '',
        createdById: actor.id,
      },
    });

    await logAudit(
      actor,
      'appointment.created',
      created.reference,
      `${slot.id} · ${fee} BDT · ${source}`,
      tx
    );

    if (input.collectCash && actor.role !== 'patient') {
      await recordCashPaymentInTx(
        created.id,
        actor,
        input.cashNote || `Collected at reception desk by ${userDisplayName(actor)}`,
        tx
      );
    }

    return tx.appointment.findUniqueOrThrow({
      where: { id: created.id },
      include: {
        patient: true,
        createdBy: true,
        cancelledBy: true,
        payments: { include: { handledBy: true }, orderBy: { createdAt: 'desc' } },
        refund: true,
        slot: {
          include: {
            doctor: {
              include: {
                user: true,
                department: true,
                chamber: true,
                weekly: true,
                receptionists: { include: { user: true } },
              },
            },
          },
        },
      },
    });
  });
}

async function recordCashPaymentInTx(
  appointmentId: bigint,
  actor: User,
  note: string,
  tx: Prisma.TransactionClient
) {
  await tx.$queryRaw`
    SELECT id FROM hospital_appointment WHERE id = ${appointmentId} FOR UPDATE
  `;
  const appt = await tx.appointment.findUnique({
    where: { id: appointmentId },
    include: { slot: { include: { doctor: true } } },
  });
  if (!appt) throw new HttpError(404, 'Appointment not found.');

  const isStaffRole = actor.isActive && ['admin', 'receptionist'].includes(actor.role);
  const allowed = await doctorAllowed(actor, appt.slot.doctor, tx);
  if (!isStaffRole || !allowed) {
    throw new HttpError(403, 'Not authorized to record this payment.');
  }

  if (appt.status === 'cancelled' || appt.status === 'expired') {
    throw new HttpError(400, 'Cancelled or expired appointments cannot be paid.');
  }
  if (appt.status === 'pending' && appt.paymentDueAt && appt.paymentDueAt <= new Date()) {
    throw new HttpError(400, 'The payment deadline has passed. Please arrange a new booking.');
  }
  if (appt.paymentStatus !== 'unpaid') {
    throw new HttpError(400, 'Payment has already been recorded.');
  }
  if (!acceptsPayment(appt.acceptedPaymentMethods, 'cash')) throw new HttpError(400, 'Counter payment is unavailable for this appointment.');
  if (await tx.paymentTransaction.count({ where: { appointmentId, status: 'initiated', kind: 'charge' } })) {
    throw new HttpError(409, 'An online checkout is already in progress.');
  }

  const paidAt = new Date();
  const shares = await settleMonthlyCommission(tx, appt, appt.slot.doctorId, paidAt);

  const updated = await tx.appointment.update({
    where: { id: appt.id },
    data: {
      ...shares,
      paymentStatus: 'paid',
      paymentMethod: 'cash',
      status: appt.status === 'pending' ? 'confirmed' : appt.status,
    },
  });

  await tx.paymentTransaction.create({
    data: {
      appointmentId: appt.id,
      kind: 'charge',
      method: 'cash',
      status: 'verified',
      amount: appt.fee,
      handledById: actor.id,
      note: note.slice(0, 255),
      processedAt: paidAt,
    },
  });

  await logAudit(actor, 'payment.cash_verified', appt.reference, note, tx);
  return updated;
}

export async function recordCashPayment(
  appointmentId: bigint,
  actor: User,
  note = 'Collected at reception',
  transaction?: Prisma.TransactionClient
) {
  if (transaction) return recordCashPaymentInTx(appointmentId, actor, note, transaction);
  return prisma.$transaction((tx) => recordCashPaymentInTx(appointmentId, actor, note, tx));
}

export async function cancelAppointment(
  appointmentId: bigint,
  actor: User,
  opts: { byDoctor?: boolean; reason?: string } = {},
  transaction?: Prisma.TransactionClient
) {
  const byDoctor = Boolean(opts.byDoctor);
  const reason = (opts.reason || '').slice(0, 500);

  const perform = async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`
      SELECT id FROM hospital_appointment WHERE id = ${appointmentId} FOR UPDATE
    `;
    const appt = await tx.appointment.findUnique({
      where: { id: appointmentId },
      include: { slot: { include: { doctor: true } } },
    });
    if (!appt) throw new HttpError(404, 'Appointment not found.');

    if (appt.status !== 'pending' && appt.status !== 'confirmed') {
      throw new HttpError(400, 'Only upcoming active appointments may be cancelled.');
    }

    if (localStartUtc(appt.slot.date, appt.slot.startTime) <= new Date()) {
      throw new HttpError(400, 'Appointments that have started must be handled by hospital staff.');
    }

    if (!actor.isActive || actor.role === 'patient' || !(await doctorAllowed(actor, appt.slot.doctor, tx))) {
      throw new HttpError(403, 'Not authorized for this appointment.');
    }
    if (actor.role === 'receptionist') {
      const authorized = await tx.complaint.findFirst({ where: { appointmentId, category: 'cancel_appointment', status: 'approved', recipientId: actor.id } });
      if (!authorized) throw new HttpError(403, 'An administrator-approved cancellation request is required.');
    }

    if (byDoctor && actor.role !== 'doctor' && actor.role !== 'admin') {
      throw new HttpError(
        403,
        'Only the doctor or administrator can initiate a doctor-side cancellation.'
      );
    }

    const paid = appt.paymentStatus === 'paid';


    if (paid) {
      const fee = Number(appt.fee);
      const snapVal = Number(appt.cancelValueSnapshot);
      let refundable = 0;
      if (byDoctor) {
        refundable = fee;
      } else if (appt.cancelModeSnapshot === 'fixed') {
        refundable = Math.max(0, round2(fee - snapVal));
      } else {
        const penalty = round2((fee * Math.min(snapVal, 100)) / 100);
        refundable = Math.max(0, round2(fee - penalty));
      }

      if (refundable > 0) {
        const existingRefund = await tx.refundRequest.findUnique({
          where: { appointmentId: appt.id },
        });
        if (!existingRefund) {
          await tx.refundRequest.create({
            data: {
              appointmentId: appt.id,
              amount: refundable,
              mode: appt.paymentMethod === 'online' ? 'online' : 'cash',
              status: 'pending',
              requestedById: actor.role === 'doctor' ? null : actor.id,
              reason: reason || (byDoctor ? 'Doctor cancellation' : 'Patient cancellation'),
            },
          });
        }
      }
    }

    const updated = await tx.appointment.update({
      where: { id: appt.id },
      data: {
        status: 'cancelled',
        cancelledById: actor.id,
        cancellationReason: reason,
      },
    });
    await tx.complaint.updateMany({ where: { appointmentId, category: 'cancel_appointment', status: 'approved' }, data: { status: 'resolved', updatedById: actor.id } });

    await logAudit(
      actor,
      'appointment.cancelled',
      appt.reference,
      `doctor_side=${byDoctor ? 'True' : 'False'}; reason=${reason}`,
      tx
    );
    return updated;
  };
  return transaction ? perform(transaction) : prisma.$transaction(perform);
}

export async function changeVisitStatus(appointmentId: bigint, actor: User, newStatus: string, transaction?: Prisma.TransactionClient) {
  const perform = async (tx: Prisma.TransactionClient) => {
    await tx.$queryRaw`
      SELECT id FROM hospital_appointment WHERE id = ${appointmentId} FOR UPDATE
    `;
    const appt = await tx.appointment.findUnique({
      where: { id: appointmentId },
      include: { slot: { include: { doctor: true } } },
    });
    if (!appt) throw new HttpError(404, 'Appointment not found.');

    if (!(await doctorAllowed(actor, appt.slot.doctor, tx))) {
      throw new HttpError(403, 'Not authorized.');
    }

    if ((newStatus !== 'completed' && newStatus !== 'no_show') || appt.status !== 'confirmed') {
      throw new HttpError(400, 'Only confirmed appointments can be marked completed or no-show.');
    }

    if (localStartUtc(appt.slot.date, appt.slot.startTime) > new Date()) {
      throw new HttpError(400, 'Future appointments cannot be marked as attended.');
    }

    if (newStatus === 'completed' && appt.paymentStatus !== 'paid') {
      throw new HttpError(400, 'Record payment before completing this appointment.');
    }

    const updated = await tx.appointment.update({
      where: { id: appt.id },
      data: { status: newStatus },
    });

    await logAudit(actor, `appointment.${newStatus}`, appt.reference, '', tx);
    return updated;
  };
  return transaction ? perform(transaction) : prisma.$transaction(perform);
}

export async function reconcileExpired(): Promise<number> {
  const now = new Date();
  const candidates = await prisma.appointment.findMany({
    where: {
      status: 'pending',
      paymentStatus: 'unpaid',
      paymentDueAt: { lte: now },
    },
    select: { id: true },
    take: 500,
  });

  let count = 0;
  for (const row of candidates) {
    const expired = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`
        SELECT id FROM hospital_appointment WHERE id = ${row.id} FOR UPDATE
      `;
      const appt = await tx.appointment.findUnique({ where: { id: row.id } });
      if (
        appt &&
        appt.status === 'pending' &&
        appt.paymentStatus === 'unpaid' &&
        appt.paymentDueAt &&
        appt.paymentDueAt <= now
      ) {
        await tx.appointment.update({
          where: { id: appt.id },
          data: { status: 'expired' },
        });
        await logAudit(null, 'appointment.expired', appt.reference, '', tx);
        return true;
      }
      return false;
    });
    if (expired) count++;
  }
  return count;
}

export async function collectedRevenueShares(
  appointments: Array<{ id: bigint; fee: unknown; hospitalCut: unknown }>,
  db: DbClient = prisma
): Promise<{ hospital: number; doctor: number }> {
  if (!appointments.length) return { hospital: 0, doctor: 0 };

  const ids = appointments.map((a) => a.id);
  const [charges, refunds] = await Promise.all([
    db.paymentTransaction.groupBy({
      by: ['appointmentId'],
      where: { appointmentId: { in: ids }, kind: 'charge', status: 'verified' },
      _sum: { amount: true },
    }),
    db.paymentTransaction.groupBy({
      by: ['appointmentId'],
      where: { appointmentId: { in: ids }, kind: 'refund', status: 'refunded' },
      _sum: { amount: true },
    }),
  ]);

  const cashMap = new Map<bigint, number>();
  for (const c of charges) {
    cashMap.set(c.appointmentId, Number(c._sum.amount || 0));
  }
  const refundMap = new Map<bigint, number>();
  for (const r of refunds) {
    refundMap.set(r.appointmentId, Number(r._sum.amount || 0));
  }

  let hospital = 0;
  let doctor = 0;
  for (const appt of appointments) {
    const paid = cashMap.get(appt.id);
    if (paid === undefined) continue;
    const refunded = refundMap.get(appt.id) || 0;
    const retained = Math.max(0, round2(paid - refunded));
    const fee = Number(appt.fee);
    const hCut = Number(appt.hospitalCut);
    const house = fee ? Math.min(retained, round2((retained * hCut) / fee)) : 0;
    hospital = round2(hospital + house);
    doctor = round2(doctor + round2(retained - house));
  }
  return { hospital, doctor };
}
