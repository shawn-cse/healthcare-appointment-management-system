import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import { HttpError } from '../middleware/error.js';
import {
  appointmentAllowed,
  appointmentScopeWhere,
  managedDoctorIds,
} from '../services/access.js';
import {
  calcHospitalCut,
  acceptsPayment,
  ACTIVE_APPOINTMENT_STATUSES,
  cancelAppointment,
  changeVisitStatus,
  createAppointment,
  feeFor,
  recordCashPayment,
  round2,
  validateSlotForBooking,
} from '../services/appointments.js';
import { logAudit } from '../services/audit.js';
import { initializeGatewayPayment, reconcileGatewayCheckout, verifyGatewayCallback } from '../services/gateway.js';
import { serializeAppointment, serializeDoctor, userDisplayName } from '../services/serialize.js';
import { addDaysDate, localStartUtc, localTodayDate, parseIsoDate } from '../utils/dateTime.js';
import { normalizePhone, PHONE_REGEX } from '../utils/phone.js';

const appointmentInclude = {
  patient: true,
  createdBy: true,
  cancelledBy: true,
  payments: { include: { handledBy: true }, orderBy: { createdAt: 'desc' as const } },
  refund: { include: { requestedBy: true, reviewedBy: true } },
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
};

export async function listAppointments(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const docIds = await managedDoctorIds(user);
  const scope = appointmentScopeWhere(user, docIds);
  const filters: Prisma.AppointmentWhereInput[] = [scope];

  const status = String(req.query.status || '').trim();
  if (['pending', 'confirmed', 'completed', 'cancelled', 'expired', 'no_show'].includes(status)) {
    filters.push({ status });
  }

  const payment = String(req.query.payment || '').trim();
  if (
    ['paid', 'unpaid', 'refund_pending', 'refunded', 'partially_refunded'].includes(payment)
  ) {
    filters.push({ paymentStatus: payment });
  }
  const paymentMethod = String(req.query.payment_method || '');
  const visitType = String(req.query.visit_type || '');
  if (['cash', 'online'].includes(paymentMethod)) filters.push({ paymentMethod });
  if (['first', 'followup', 'report'].includes(visitType)) filters.push({ visitType });

  const today = localTodayDate();
  const datePreset = String(req.query.date_preset || '').trim();
  const dateFrom = String(req.query.date_from || '').trim();
  const dateTo = String(req.query.date_to || '').trim();
  const dateExact = String(req.query.date || '').trim();

  if (datePreset === 'today') {
    filters.push({ slot: { date: today } });
  } else if (datePreset === 'upcoming') {
    filters.push({ slot: { date: { gte: today } } });
  } else if (datePreset === '7d' || datePreset === 'week') {
    filters.push({ slot: { date: { gte: addDaysDate(today, -7), lte: today } } });
  } else if (datePreset === '30d') {
    filters.push({ slot: { date: { gte: addDaysDate(today, -30), lte: today } } });
  } else if (datePreset === 'custom' || dateFrom || dateTo) {
    const df = parseIsoDate(dateFrom);
    const dt = parseIsoDate(dateTo);
    if (df) filters.push({ slot: { date: { gte: df } } });
    if (dt) filters.push({ slot: { date: { lte: dt } } });
  } else if (dateExact) {
    const exact = parseIsoDate(dateExact);
    if (exact) filters.push({ slot: { date: exact } });
  }

  const docParam = String(req.query.doctor || '').trim();
  if (/^\d+$/.test(docParam)) {
    filters.push({ slot: { doctorId: BigInt(docParam) } });
  }

  const qRaw = String(req.query.q || '').trim();
  if (qRaw) {
    const cleanQ = qRaw.replace(/[\[\]]/g, '').trim();
    if (cleanQ) {
      filters.push({
        OR: [
          { reference: { contains: cleanQ, mode: 'insensitive' } },
          { guestName: { contains: cleanQ, mode: 'insensitive' } },
          { guestPhone: { contains: cleanQ, mode: 'insensitive' } },
          { patient: { firstName: { contains: cleanQ, mode: 'insensitive' } } },
          { patient: { lastName: { contains: cleanQ, mode: 'insensitive' } } },
          { patient: { username: { contains: cleanQ, mode: 'insensitive' } } },
          { slot: { doctor: { user: { firstName: { contains: cleanQ, mode: 'insensitive' } } } } },
          { slot: { doctor: { user: { lastName: { contains: cleanQ, mode: 'insensitive' } } } } },
          { slot: { doctor: { user: { username: { contains: cleanQ, mode: 'insensitive' } } } } },
          { slot: { doctor: { department: { name: { contains: cleanQ, mode: 'insensitive' } } } } },
          { status: { contains: cleanQ.replace(/[- ]/g, '_'), mode: 'insensitive' } },
          { paymentStatus: { contains: cleanQ.replace(/[- ]/g, '_'), mode: 'insensitive' } },
          { visitType: { contains: /report/i.test(cleanQ) ? 'report' : /follow.?up/i.test(cleanQ) ? 'followup' : /first visit/i.test(cleanQ) ? 'first' : cleanQ, mode: 'insensitive' } },
          ...(parseIsoDate(cleanQ) ? [{ slot: { date: parseIsoDate(cleanQ)! } }] : []),
        ],
      });
    }
  }

  const defaultSort = user.role === 'patient' ? 'oldest' : 'newest';
  const sort = String(req.query.sort || defaultSort);
  let orderBy: Prisma.AppointmentOrderByWithRelationInput[];
  switch (sort) {
    case 'oldest':
      orderBy = [{ createdAt: 'asc' }, { id: 'asc' }];
      break;
    case 'payment':
      orderBy = [{ paymentStatus: 'asc' }, { createdAt: 'desc' }, { id: 'asc' }];
      break;
    case 'date_asc':
    case 'oldest_date':
      orderBy = [{ slot: { date: 'asc' } }, { slot: { startTime: 'asc' } }, { id: 'asc' }];
      break;
    case 'date_desc':
    case 'newest_date':
      orderBy = [{ slot: { date: 'desc' } }, { slot: { startTime: 'desc' } }, { id: 'asc' }];
      break;
    case 'created_desc':
      orderBy = [{ createdAt: 'desc' }, { id: 'asc' }];
      break;
    case 'patient':
      orderBy = [{ guestName: 'asc' }, { id: 'asc' }];
      break;
    case 'fee_asc':
      orderBy = [{ fee: 'asc' }, { id: 'asc' }];
      break;
    case 'fee_desc':
      orderBy = [{ fee: 'desc' }, { id: 'asc' }];
      break;
    case 'status':
      orderBy = [{ status: 'asc' }, { id: 'asc' }];
      break;
    default:
      orderBy = [{ createdAt: 'desc' }, { id: 'asc' }];
      break;
  }
  const [field, direction] = sort.split('.');
  if (direction === 'asc' || direction === 'desc') {
    const columns: Record<string, Prisma.AppointmentOrderByWithRelationInput[]> = {
      reference: [{ reference: direction }], patient: [{ guestName: direction }],
      doctor: [{ slot: { doctor: { user: { firstName: direction } } } }],
      date: [{ slot: { date: direction } }, { slot: { startTime: direction } }],
      visit: [{ visitType: direction }], payment: [{ paymentStatus: direction }, { fee: direction }],
      status: [{ status: direction }],
    };
    if (Object.hasOwn(columns, field)) orderBy = [...columns[field], { id: 'asc' }];
  }

  const showAll = String(req.query.limit || '').toLowerCase() === 'all';
  const page = showAll ? 1 : Math.max(1, Number(req.query.page || 1) || 1);
  const limit = showAll ? 0 : Math.min(100, Math.max(1, Number(req.query.limit || 25) || 25));
  const where: Prisma.AppointmentWhereInput = { AND: filters };

  const [total, items, doctorOptions] = await Promise.all([
    prisma.appointment.count({ where }),
    prisma.appointment.findMany({
      where,
      include: appointmentInclude,
      orderBy,
      ...(limit ? { skip: (page - 1) * limit, take: limit } : {}),
    }),
    user.role !== 'patient'
      ? prisma.doctorProfile.findMany({
          where: docIds === null ? {} : { id: { in: docIds } },
          include: { user: true, department: true, chamber: true },
          orderBy: [{ user: { firstName: 'asc' } }],
        })
      : Promise.resolve([]),
  ]);

  res.json({
    appointments: items.map(serializeAppointment),
    total,
    page,
    limit: limit || total,
    total_pages: limit ? Math.max(1, Math.ceil(total / limit)) : 1,
    active_sort: sort,
    doctor_options: doctorOptions.map(serializeDoctor),
  });
}

export async function getAppointment(req: Request, res: Response): Promise<void> {
  if (!/^\d+$/.test(req.params.id)) throw new HttpError(404, 'Appointment not found.');
  const id = BigInt(req.params.id);
  const appt = await prisma.appointment.findUnique({
    where: { id },
    include: appointmentInclude,
  });
  if (!appt) throw new HttpError(404, 'Appointment not found.');
  if (!(await appointmentAllowed(req.user!, appt))) {
    throw new HttpError(404, 'Appointment not found.');
  }

  let linkedCandidate: { id: number; display_name: string } | null = null;
  if (['admin', 'receptionist'].includes(req.user!.role) && !appt.patientId) {
    const candidate = await prisma.user.findFirst({
      where: { role: 'patient', isActive: true, phone: normalizePhone(appt.guestPhone), phoneVerifiedAt: { not: null } },
      select: { id: true, firstName: true, lastName: true, username: true },
    });
    if (candidate) {
      linkedCandidate = { id: Number(candidate.id), display_name: userDisplayName(candidate) };
    }
  }

  res.json({
    appointment: serializeAppointment(appt),
    linked_candidate: linkedCandidate,
    patient_access: req.user!.role === 'admin' && appt.patient ? { is_active: appt.patient.isActive, login_allowed: appt.patient.loginAllowed } : null,
    operational_requests: ['admin', 'receptionist', 'doctor'].includes(req.user!.role) ? (await prisma.complaint.findMany({ where: {
      appointmentId: id,
      ...(req.user!.role === 'receptionist' ? { recipientId: req.user!.id } : {}),
    }, select: { id: true, subject: true, category: true, status: true } })).map((item) => ({ ...item, id: Number(item.id) })) : [],
    patient_history: ['admin', 'doctor'].includes(req.user!.role) && appt.patientId ? (await prisma.appointment.findMany({ where: { patientId: appt.patientId, id: { not: id }, ...(req.user!.role === 'doctor' ? { slot: { doctorId: appt.slot.doctorId } } : {}) }, select: { id: true, reference: true, status: true, slot: { select: { date: true } } }, take: 20, orderBy: { createdAt: 'desc' } })).map((item) => ({ id: Number(item.id), reference: item.reference, date: item.slot.date.toISOString().slice(0, 10), status: item.status })) : [],
  });
}

export async function bookAppointment(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const slotRaw = req.body?.slot_id ?? req.body?.slot;
  if (!slotRaw || !/^\d+$/.test(String(slotRaw))) {
    throw new HttpError(400, 'Please select a valid consultation slot.');
  }

  const patientRaw = req.body?.patient_id ?? req.body?.patient;
  if (patientRaw && !/^\d+$/.test(String(patientRaw))) throw new HttpError(400, 'Invalid patient account.');
  const patientId =
    patientRaw !== undefined && patientRaw !== null && String(patientRaw).trim() !== ''
      ? BigInt(String(patientRaw))
      : user.role === 'patient'
        ? user.id
        : null;

  const dobRaw = req.body?.dob ? String(req.body.dob).trim() : '';
  let dob: Date | null = null;
  if (dobRaw) {
    const parsed = parseIsoDate(dobRaw);
    if (!parsed) throw new HttpError(400, 'Invalid date of birth.');
    if (parsed > new Date()) throw new HttpError(400, 'Date of birth cannot be in the future.');
    dob = parsed;
  }

  if (user.role !== 'patient' && patientId && req.body?.identity_verified !== true) {
    throw new HttpError(400, 'Confirm identity before linking to an existing account.');
  }
  const age = req.body?.age === undefined || req.body.age === '' ? null : Number(req.body.age);
  const gender = String(req.body?.gender || '');
  if (user.role !== 'patient' && (age === null || !Number.isInteger(age) || age < 0 || age > 130 || !['female', 'male', 'other'].includes(gender))) {
    throw new HttpError(400, 'Enter the patient age and gender.');
  }
  const phone = normalizePhone(String(req.body?.phone || ''));
  if (user.role !== 'patient' && !PHONE_REGEX.test(phone)) throw new HttpError(400, 'Enter a valid patient phone number.');

  const collectCash =
    user.role !== 'patient' &&
    (req.body?.payment_choice === 'cash' || req.body?.collect_cash === true);

  const appt = await createAppointment({
    actor: user,
    slotId: BigInt(String(slotRaw)),
    patientId,
    name: req.body?.name,
    phone,
    dob: user.role === 'patient' ? dob : null,
    age,
    gender: gender || null,
    identityVerified: req.body?.identity_verified === true,
    visitType: req.body?.visit_type || 'first',
    source: req.body?.source || (user.role === 'patient' ? 'web' : 'desk'),
    paymentMethod: req.body?.payment_method || 'cash',
    notes: req.body?.notes || '',
    collectCash,
  });

  res.status(201).json({
    appointment: serializeAppointment(appt),
    message:
      user.role === 'patient'
        ? `Appointment ${appt.reference} has been reserved.`
        : `Appointment ${appt.reference} booked successfully for ${appt.guestName}.`,
  });
}

export async function quickUpdateAppointment(req: Request, res: Response): Promise<void> {
  const id = BigInt(req.params.id);
  const existing = await prisma.appointment.findUnique({
    where: { id },
    include: appointmentInclude,
  });
  if (!existing || !(await appointmentAllowed(req.user!, existing))) {
    throw new HttpError(404, 'Appointment not found.');
  }

  const visitType = String(req.body?.visit_type || '').trim();
  const customFeeRaw = req.body?.fee !== undefined ? String(req.body.fee).trim() : '';
  const newStatus = String(req.body?.status || '').trim();
  const cancellationReason = String(req.body?.cancellation_reason || '').trim();
  const collectCash =
    req.body?.collect_cash === true ||
    req.body?.collect_cash === '1' ||
    req.body?.collect_cash === 'true';

  const doctor = existing.slot.doctor;
  const updateData: Prisma.AppointmentUpdateInput = {};
  if (collectCash && req.user!.role === 'doctor') throw new HttpError(403, 'Only reception or administration can collect payment.');
  if (req.user!.role === 'receptionist' && (visitType || customFeeRaw || newStatus === 'cancelled')) {
    throw new HttpError(403, 'Use an authorized appointment request for this change.');
  }
  if ((visitType || customFeeRaw) && existing.paymentStatus !== 'unpaid') throw new HttpError(409, 'Paid consultation fees and visit types are locked.');

  if (visitType || customFeeRaw) {
    if (!['pending', 'confirmed'].includes(existing.status)) throw new HttpError(409, 'Only active bookings can have their fees adjusted.');
    if (customFeeRaw !== '' && (!Number.isFinite(Number(customFeeRaw)) || Number(customFeeRaw) < 0 || Number(customFeeRaw) > 9_999_999.99)) throw new HttpError(400, 'Enter a valid consultation fee.');
    const baseFee = visitType && visitType !== existing.visitType
      ? await feeFor(doctor, visitType, { patient: existing.patient, appointmentDate: existing.slot.date })
      : Number(existing.fee);
    const fee = customFeeRaw !== '' ? round2(Number(customFeeRaw)) : baseFee;
    if (visitType) updateData.visitType = visitType;
    const rule = { hospitalShareMode: existing.commissionMode ?? doctor.hospitalShareMode, hospitalShareValue: existing.commissionValue ?? doctor.hospitalShareValue };
    if (rule.hospitalShareMode === 'fixed' && Number(rule.hospitalShareValue) > fee) throw new HttpError(400, 'The fee cannot be below the hospital commission.');
    const hCut = calcHospitalCut(rule, fee);
    updateData.fee = fee;
    updateData.hospitalCut = hCut;
    updateData.doctorCut = Math.max(0, round2(fee - hCut));
  }

  if (newStatus && newStatus !== existing.status && !['completed', 'cancelled', 'no_show'].includes(newStatus)) {
    throw new HttpError(400, 'Select an allowed status transition.');
  }
  if (newStatus === 'cancelled' && collectCash) throw new HttpError(400, 'A cancellation cannot include payment collection.');
  if (req.body?.notes !== undefined) updateData.notes = String(req.body.notes).trim();

  const finalAppt = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM hospital_appointment WHERE id = ${id} FOR UPDATE`;
    const current = await tx.appointment.findUniqueOrThrow({ where: { id }, include: { slot: true } });
    if (+current.updatedAt !== +existing.updatedAt || !(await appointmentAllowed(req.user!, current, tx))) {
      throw new HttpError(409, 'The appointment changed. Reload it and try again.');
    }
    if (updateData.fee !== undefined && await tx.paymentTransaction.count({ where: { appointmentId: id, kind: 'charge', status: { in: ['initiated', 'verified'] } } })) {
      throw new HttpError(409, 'A payment is in progress or already recorded.');
    }
    if (Object.keys(updateData).length) await tx.appointment.update({ where: { id }, data: updateData });
    if (collectCash) await recordCashPayment(id, req.user!, 'Quick cash collection at desk', tx);
    if (newStatus && newStatus !== existing.status) {
      if (newStatus === 'cancelled') await cancelAppointment(id, req.user!, { byDoctor: true, reason: cancellationReason || 'Cancelled via quick desk' }, tx);
      else await changeVisitStatus(id, req.user!, newStatus, tx);
    }
    const updated = await tx.appointment.findUniqueOrThrow({ where: { id }, include: appointmentInclude });
    await logAudit(req.user, 'appointment.quick_update', updated.reference, JSON.stringify({
      before: { visit: existing.visitType, fee: existing.fee, status: existing.status, payment: existing.paymentStatus },
      after: { visit: updated.visitType, fee: updated.fee, status: updated.status, payment: updated.paymentStatus },
    }), tx);
    return updated;
  });

  const serialized = serializeAppointment(finalAppt);
  res.json({
    success: true,
    message: `Appointment [${finalAppt.reference}] updated successfully.`,
    appointment: serialized,
    reference: serialized.reference,
    visit_type: serialized.visit_type,
    visit_type_display: serialized.visit_type_display,
    fee: String(serialized.fee),
    status: serialized.status,
    status_display: serialized.status_display,
    payment_status: serialized.payment_status,
    payment_status_display: serialized.payment_status_display,
  });
}

export async function collectPayment(req: Request, res: Response): Promise<void> {
  const id = BigInt(req.params.id);
  const existing = await prisma.appointment.findUnique({
    where: { id },
    include: { slot: { include: { doctor: true } } },
  });
  if (!existing || !(await appointmentAllowed(req.user!, existing))) {
    throw new HttpError(404, 'Appointment not found.');
  }

  if (req.body?.amount !== undefined && Number(req.body.amount) !== Number(existing.fee)) throw new HttpError(400, 'Record the full consultation fee in one payment.');

  await recordCashPayment(id, req.user!, req.body?.note || 'Collected at reception');
  const updated = await prisma.appointment.findUniqueOrThrow({
    where: { id },
    include: appointmentInclude,
  });
  res.json({
    appointment: serializeAppointment(updated),
    message: 'Cash payment recorded and appointment confirmed.',
  });
}

export async function cancelAppt(req: Request, res: Response): Promise<void> {
  const id = BigInt(req.params.id);
  const existing = await prisma.appointment.findUnique({
    where: { id },
    include: { slot: { include: { doctor: true } } },
  });
  if (!existing || !(await appointmentAllowed(req.user!, existing))) {
    throw new HttpError(404, 'Appointment not found.');
  }

  const byDoctor =
    (req.body?.actor_type === 'doctor' || req.body?.by_doctor === true) &&
    ['doctor', 'admin'].includes(req.user!.role);

  await cancelAppointment(id, req.user!, {
    byDoctor,
    reason: String(req.body?.reason || ''),
  });

  const updated = await prisma.appointment.findUniqueOrThrow({
    where: { id },
    include: appointmentInclude,
  });
  res.json({
    appointment: serializeAppointment(updated),
    message: 'Appointment cancelled. Any eligible refund has been queued for review.',
  });
}

async function assertApprovedRequest(id: bigint, category: string, recipientId: bigint, db: Pick<typeof prisma, 'complaint'> = prisma) {
  const request = await db.complaint.findFirst({ where: { appointmentId: id, category, status: 'approved', recipientId } });
  if (!request) throw new HttpError(403, 'An administrator-approved request assigned to you is required.');
}

export async function rescheduleAppointment(req: Request, res: Response): Promise<void> {
  const id = BigInt(req.params.id);
  const rawSlot = String(req.body?.slot_id || '');
  if (!/^\d+$/.test(rawSlot)) throw new HttpError(400, 'Select an available consultation time.');
  const actor = req.user!;
  await prisma.$transaction(async (tx) => {
    const target = BigInt(rawSlot);
    await tx.$queryRaw`SELECT id FROM hospital_appointmentslot WHERE id = ${target} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM hospital_appointment WHERE id = ${id} FOR UPDATE`;
    const appt = await tx.appointment.findUnique({ where: { id }, include: { slot: { include: { doctor: true } } } });
    if (!appt || !(await appointmentAllowed(actor, appt, tx))) throw new HttpError(404, 'Appointment not found.');
    if (actor.role === 'receptionist') await assertApprovedRequest(id, 'reschedule', actor.id, tx);
    if (!['pending', 'confirmed'].includes(appt.status)) throw new HttpError(400, 'Only upcoming appointments can be rescheduled.');
    if (appt.slotId === target) return;
    const slot = await tx.appointmentSlot.findUnique({ where: { id: target }, include: { doctor: { include: { user: true, department: true, chamber: true } } } });
    if (!slot || slot.doctorId !== appt.slot.doctorId) throw new HttpError(400, 'Select a time for the same doctor.');
    validateSlotForBooking(slot, true);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`booking:${appt.guestPhone}`}, 0))`;
    const duplicates = await tx.appointment.count({ where: { id: { not: id }, guestPhone: appt.guestPhone, status: { in: ACTIVE_APPOINTMENT_STATUSES }, slot: { date: slot.date, startTime: slot.startTime } } });
    if (duplicates) throw new HttpError(409, 'The patient already has a booking at this time.');
    const active = await tx.appointment.count({ where: { slotId: target, status: { in: ACTIVE_APPOINTMENT_STATUSES } } });
    const existingSerial = await tx.appointment.aggregate({ where: { slotId: target }, _max: { serialNumber: true } });
    if (active >= slot.capacity) throw new HttpError(409, 'This consultation time is full.');
    const start = localStartUtc(slot.date, slot.startTime);
    const due = appt.paymentStatus === 'unpaid' && appt.paymentDueAt
      ? new Date(appt.paymentDeadlineHours == null ? Math.min(+appt.paymentDueAt, +start) : +start - appt.paymentDeadlineHours * 3_600_000)
      : appt.paymentDueAt;
    if (appt.paymentStatus === 'unpaid' && due && due <= new Date()) throw new HttpError(400, 'The payment deadline would already have passed.');
    await tx.appointment.update({ where: { id }, data: { slotId: target, serialNumber: (existingSerial._max.serialNumber ?? 0) + 1, paymentDueAt: due } });
    await tx.complaint.updateMany({ where: { appointmentId: id, category: 'reschedule', status: 'approved' }, data: { status: 'resolved', updatedById: actor.id } });
    await logAudit(actor, 'appointment.rescheduled', appt.reference, `Slot ${appt.slotId} → ${target}`, tx);
  });
  res.json({ appointment: serializeAppointment(await prisma.appointment.findUniqueOrThrow({ where: { id }, include: appointmentInclude })), message: 'Appointment rescheduled.' });
}

export async function setStatus(req: Request, res: Response): Promise<void> {
  const id = BigInt(req.params.id);
  const existing = await prisma.appointment.findUnique({
    where: { id },
    include: { slot: { include: { doctor: true } } },
  });
  if (!existing || !(await appointmentAllowed(req.user!, existing))) {
    throw new HttpError(404, 'Appointment not found.');
  }

  await changeVisitStatus(id, req.user!, String(req.body?.status || ''));
  const updated = await prisma.appointment.findUniqueOrThrow({
    where: { id },
    include: appointmentInclude,
  });
  res.json({
    appointment: serializeAppointment(updated),
    message: 'Appointment status updated.',
  });
}

export async function bulkAppointments(req: Request, res: Response): Promise<void> {
  const selectedRaw = Array.isArray(req.body?.selected) ? req.body.selected : [];
  const ids = selectedRaw
    .filter((x: unknown) => /^\d+$/.test(String(x)))
    .slice(0, 200)
    .map((x: unknown) => BigInt(String(x)));
  const action = String(req.body?.action || '');

  const docIds = await managedDoctorIds(req.user!);
  const scope = appointmentScopeWhere(req.user!, docIds);
  const appts = await prisma.appointment.findMany({
    where: { AND: [scope, { id: { in: ids } }] },
    select: { id: true },
  });

  let count = 0;
  let errors = 0;
  for (const a of appts) {
    try {
      if (action === 'cash') {
        await recordCashPayment(a.id, req.user!);
      } else if (action === 'completed' || action === 'no_show') {
        await changeVisitStatus(a.id, req.user!, action);
      } else if (action === 'doctor_cancel') {
        await cancelAppointment(a.id, req.user!, {
          byDoctor: true,
          reason: 'Doctor cancelled clinic',
        });
      } else {
        throw new HttpError(400, 'Unsupported bulk action.');
      }
      count++;
    } catch {
      errors++;
    }
  }

  res.json({
    updated: count,
    errors,
    message: count
      ? `${count} appointments updated.${errors ? ` (${errors} skipped)` : ''}`
      : 'No appointments could be updated.',
  });
}

export async function linkPatient(req: Request, res: Response): Promise<void> {
  const id = BigInt(req.params.id);
  const appt = await prisma.appointment.findUnique({
    where: { id },
    include: { slot: { include: { doctor: true } } },
  });
  if (!appt || !(await appointmentAllowed(req.user!, appt))) {
    throw new HttpError(404, 'Appointment not found.');
  }

  const patientIdRaw = String(req.body?.patient_id || '');
  const verified = req.body?.verified === 'yes' || req.body?.verified === true;
  if (!/^\d+$/.test(patientIdRaw) || !verified) {
    throw new HttpError(400, 'Confirm identity and select a registered patient account.');
  }

  const patientUser = await prisma.user.findFirst({
    where: { id: BigInt(patientIdRaw), role: 'patient' },
  });
  if (!patientUser?.phoneVerifiedAt) throw new HttpError(404, 'Phone-verified patient account not found.');

  if (normalizePhone(appt.guestPhone) !== patientUser.phone) {
    throw new HttpError(400, 'Account phone does not match the appointment phone.');
  }
  if (appt.patientId && appt.patientId !== patientUser.id) {
    throw new HttpError(400, 'This appointment is already associated with another account.');
  }

  const result = await prisma.appointment.updateMany({
    where: { id: appt.id, OR: [{ patientId: null }, { patientId: patientUser.id }] },
    data: { patientId: patientUser.id },
  });
  if (!result.count) throw new HttpError(409, 'This appointment is already associated with another account.');
  await logAudit(req.user, 'appointment.patient_linked', appt.reference, Number(patientUser.id));

  const updated = await prisma.appointment.findUniqueOrThrow({
    where: { id: appt.id },
    include: appointmentInclude,
  });
  res.json({
    appointment: serializeAppointment(updated),
    message: 'Patient account linked after identity confirmation.',
  });
}

export async function patientLookup(req: Request, res: Response): Promise<void> {
  const phone = normalizePhone(String(req.query.phone || ''));
  const stripped = phone.replace(/^\+/, '');
  if (!/^\d+$/.test(stripped) || stripped.length < 10 || stripped.length > 15) {
    res.json({ patient: null });
    return;
  }
  const account = await prisma.user.findFirst({
    where: { role: 'patient', phone, isActive: true },
    select: { id: true, firstName: true, lastName: true, username: true, dob: true, gender: true, phoneVerifiedAt: true },
  });
  if (!account) {
    res.json({ patient: null });
    return;
  }
  let age: number | null = null;
  if (account.dob) {
    const today = localTodayDate();
    const birthday = account.dob.toISOString().slice(5, 10);
    const todayMd = today.toISOString().slice(5, 10);
    const computed = today.getUTCFullYear() - account.dob.getUTCFullYear() - Number(todayMd < birthday);
    if (computed >= 0) age = computed;
  }
  res.json({
    patient: {
      id: Number(account.id),
      name: userDisplayName(account),
      username: account.username,
      age,
      gender: account.gender || '',
      phone_verified: Boolean(account.phoneVerifiedAt),
    },
  });
}

export async function startPayment(req: Request, res: Response): Promise<void> {
  const id = BigInt(req.params.id);
  const appt = await prisma.appointment.findUnique({
    where: { id },
    include: { slot: { include: { doctor: true } } },
  });
  if (!appt || !(await appointmentAllowed(req.user!, appt))) {
    throw new HttpError(404, 'Appointment not found.');
  }
  const url = await initializeGatewayPayment(id);
  await logAudit(req.user, 'payment.gateway_started', appt.reference);
  res.json({ gateway_url: url });
}

export async function changePaymentMethod(req: Request, res: Response): Promise<void> {
  const id = BigInt(req.params.id);
  const method = String(req.body?.payment_method || '');
  const existing = await prisma.appointment.findFirst({ where: { id, patientId: req.user!.id } });
  if (!existing) throw new HttpError(404, 'Appointment not found.');
  if (existing.paymentMethod !== method && acceptsPayment(existing.acceptedPaymentMethods, method)) {
    const checkout = await prisma.paymentTransaction.findFirst({ where: { appointmentId: id, kind: 'charge', method: 'online', status: 'initiated' }, select: { externalId: true } });
    if (checkout?.externalId) await reconcileGatewayCheckout(checkout.externalId);
  }
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM hospital_appointment WHERE id = ${id} FOR UPDATE`;
    const appt = await tx.appointment.findFirst({ where: { id, patientId: req.user!.id } });
    if (!appt) throw new HttpError(404, 'Appointment not found.');
    if (!acceptsPayment(appt.acceptedPaymentMethods, method)) throw new HttpError(400, 'Select an accepted payment method.');
    if (appt.paymentStatus !== 'unpaid' || !['pending', 'confirmed'].includes(appt.status) || (appt.paymentDueAt && appt.paymentDueAt <= new Date())) throw new HttpError(409, 'The appointment is no longer payable.');
    if (method === appt.paymentMethod) return;
    if (await tx.paymentTransaction.count({ where: { appointmentId: id, kind: 'charge', status: 'initiated' } })) throw new HttpError(409, 'An online checkout is already in progress.');
    await tx.appointment.update({ where: { id }, data: { paymentMethod: method } });
    await logAudit(req.user, 'payment.method_changed', appt.reference, `${appt.paymentMethod} → ${method}`, tx);
  });
  res.json({ appointment: serializeAppointment(await prisma.appointment.findUniqueOrThrow({ where: { id }, include: appointmentInclude })) });
}

export async function paymentCallback(req: Request, res: Response): Promise<void> {
  const result = req.params.result;
  if (!['success', 'fail', 'cancel', 'ipn'].includes(result)) {
    res.status(405).send('Method not allowed');
    return;
  }
  const tranId = String(req.body?.tran_id ?? req.query?.tran_id ?? '');
  if (result === 'fail' || result === 'cancel') {
    try { await reconcileGatewayCheckout(tranId); }
    catch { /* Keep the checkout active when the provider cannot verify its final state. */ }
    res.redirect('/appointments?payment=cancelled');
    return;
  }

  try {
    const valId = String(req.body?.val_id ?? req.query?.val_id ?? '');
    const appt = await verifyGatewayCallback(valId);
    if (result === 'ipn') {
      res.status(200).send('OK');
      return;
    }
    res.redirect(`/appointments/${appt.id}?payment=success`);
  } catch {
    if (result === 'ipn') {
      res.status(503).send('Gateway verification unavailable.');
      return;
    }
    res.redirect('/dashboard?payment_error=1');
  }
}
