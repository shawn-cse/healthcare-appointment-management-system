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
  cancelAppointment,
  changeVisitStatus,
  createAppointment,
  recordCashPayment,
  round2,
} from '../services/appointments.js';
import { logAudit } from '../services/audit.js';
import { initializeGatewayPayment, verifyGatewayCallback } from '../services/gateway.js';
import { serializeAppointment, serializeDoctor, userDisplayName } from '../services/serialize.js';
import { addDaysDate, localTodayDate, parseIsoDate } from '../utils/dateTime.js';

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

  const today = localTodayDate();
  const datePreset = String(req.query.date_preset || '').trim();
  const dateFrom = String(req.query.date_from || '').trim();
  const dateTo = String(req.query.date_to || '').trim();
  const dateExact = String(req.query.date || '').trim();

  if (datePreset === 'today') {
    filters.push({ slot: { date: today } });
  } else if (datePreset === '7d') {
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
      orderBy = [{ slot: { date: 'asc' } }, { slot: { startTime: 'asc' } }, { id: 'asc' }];
      break;
    case 'date_desc':
      orderBy = [{ slot: { date: 'desc' } }, { slot: { startTime: 'desc' } }, { id: 'asc' }];
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

  const page = Math.max(1, Number(req.query.page || 1) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit || 25) || 25));
  const where: Prisma.AppointmentWhereInput = { AND: filters };

  const [total, items, doctorOptions] = await Promise.all([
    prisma.appointment.count({ where }),
    prisma.appointment.findMany({
      where,
      include: appointmentInclude,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
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
    limit,
    total_pages: Math.max(1, Math.ceil(total / limit)),
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
      where: { role: 'patient', phone: appt.guestPhone },
      select: { id: true, firstName: true, lastName: true, username: true },
    });
    if (candidate) {
      linkedCandidate = { id: Number(candidate.id), display_name: userDisplayName(candidate) };
    }
  }

  res.json({
    appointment: serializeAppointment(appt),
    linked_candidate: linkedCandidate,
  });
}

export async function bookAppointment(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const slotRaw = req.body?.slot_id ?? req.body?.slot;
  if (!slotRaw || !/^\d+$/.test(String(slotRaw))) {
    throw new HttpError(400, 'Please select a valid consultation slot.');
  }

  const patientRaw = req.body?.patient_id ?? req.body?.patient;
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

  if (user.role !== 'patient' && patientId && req.body?.identity_verified === false) {
    throw new HttpError(400, 'Confirm identity before linking to an existing account.');
  }

  const collectCash =
    user.role !== 'patient' &&
    (req.body?.payment_choice === 'cash' || req.body?.collect_cash === true);

  const appt = await createAppointment({
    actor: user,
    slotId: BigInt(String(slotRaw)),
    patientId,
    name: req.body?.name,
    phone: req.body?.phone,
    dob,
    visitType: req.body?.visit_type || 'first',
    source: req.body?.source || (user.role === 'patient' ? 'web' : 'desk'),
    paymentMethod: user.role === 'patient' ? req.body?.payment_method || 'cash' : 'cash',
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

  if (['first', 'followup', 'report'].includes(visitType)) {
    updateData.visitType = visitType;
    let fee = Number(existing.fee);
    if (customFeeRaw !== '' && !Number.isNaN(Number(customFeeRaw)) && Number(customFeeRaw) >= 0) {
      fee = round2(Number(customFeeRaw));
    } else if (visitType === 'first') {
      fee = Number(doctor.initialFee);
    } else if (visitType === 'followup') {
      fee = Number(doctor.followupFee);
    } else if (visitType === 'report') {
      fee = Number(doctor.reportFee);
    }
    const hCut = calcHospitalCut(doctor, fee);
    updateData.fee = fee;
    updateData.hospitalCut = hCut;
    updateData.doctorCut = Math.max(0, round2(fee - hCut));
  }

  if (
    ['pending', 'confirmed', 'completed', 'cancelled', 'expired', 'no_show'].includes(newStatus) &&
    newStatus !== 'cancelled'
  ) {
    updateData.status = newStatus;
  }

  if (req.body?.notes !== undefined) {
    updateData.notes = String(req.body.notes).trim();
  }

  if (Object.keys(updateData).length) {
    await prisma.appointment.update({ where: { id }, data: updateData });
  }

  if (newStatus === 'cancelled' && existing.status !== 'cancelled') {
    await cancelAppointment(id, req.user!, {
      byDoctor: ['doctor', 'admin'].includes(req.user!.role),
      reason: cancellationReason || 'Cancelled via quick desk',
    });
  }

  const afterCancel = await prisma.appointment.findUniqueOrThrow({ where: { id } });
  if (collectCash && afterCancel.paymentStatus === 'unpaid' && afterCancel.status !== 'cancelled') {
    await recordCashPayment(id, req.user!, 'Quick cash collection at desk');
  }

  const finalAppt = await prisma.appointment.findUniqueOrThrow({
    where: { id },
    include: appointmentInclude,
  });

  await logAudit(
    req.user,
    'appointment.quick_update',
    finalAppt.reference,
    `visit=${finalAppt.visitType}, fee=${Number(finalAppt.fee)}, status=${finalAppt.status}, payment=${finalAppt.paymentStatus}`
  );

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
  if (!patientUser) throw new HttpError(404, 'Registered patient account not found.');

  if (appt.guestPhone !== patientUser.phone) {
    throw new HttpError(400, 'Account phone does not match the appointment phone.');
  }
  if (appt.patientId && appt.patientId !== patientUser.id) {
    throw new HttpError(400, 'This appointment is already associated with another account.');
  }

  await prisma.appointment.update({
    where: { id: appt.id },
    data: { patientId: patientUser.id },
  });
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
  const phone = String(req.query.phone || '').trim();
  const stripped = phone.replace(/^\+/, '');
  if (!/^\d+$/.test(stripped) || stripped.length < 10 || stripped.length > 15) {
    res.json({ patient: null });
    return;
  }
  const account = await prisma.user.findFirst({
    where: { role: 'patient', phone, isActive: true },
    select: { id: true, firstName: true, lastName: true, username: true },
  });
  if (!account) {
    res.json({ patient: null });
    return;
  }
  res.json({ patient: { id: Number(account.id), name: userDisplayName(account) } });
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

export async function paymentCallback(req: Request, res: Response): Promise<void> {
  const result = req.params.result;
  if (!['success', 'fail', 'cancel', 'ipn'].includes(result)) {
    res.status(405).send('Method not allowed');
    return;
  }
  if (result === 'fail' || result === 'cancel') {
    res.redirect('/appointments?payment=cancelled');
    return;
  }

  try {
    const valId = String(req.body?.val_id || '');
    const appt = await verifyGatewayCallback(valId);
    if (result === 'ipn') {
      res.status(200).send('OK');
      return;
    }
    res.redirect(`/appointments/${appt.id}`);
  } catch {
    if (result === 'ipn') {
      res.status(503).send('Gateway verification unavailable.');
      return;
    }
    res.redirect('/dashboard?payment_error=1');
  }
}
