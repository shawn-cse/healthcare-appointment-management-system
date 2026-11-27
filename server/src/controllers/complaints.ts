import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import path from 'node:path';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { HttpError } from '../middleware/error.js';
import { managedDoctorIds } from '../services/access.js';
import { generateUniqueTicketCode, round2 } from '../services/appointments.js';
import { logAudit } from '../services/audit.js';
import { serializeAppointment, serializeComplaint, userDisplayName } from '../services/serialize.js';
import { toRelativeMediaPath } from '../utils/upload.js';

const complaintInclude = {
  patient: true,
  recipient: true,
  updatedBy: true,
  appointment: {
    include: {
      slot: {
        include: {
          doctor: {
            include: {
              user: true,
              department: true,
              chamber: true,
            },
          },
        },
      },
    },
  },
  messages: {
    include: { author: true },
    orderBy: { createdAt: 'asc' as const },
  },
};

const FORMAL_COMPLAINT_CATEGORIES = ['formal_complaint', 'doctor', 'hospital', 'staff', 'billing', 'other'];

async function buildQueueScope(user: NonNullable<Request['user']>, userType: string) {
  if (userType === 'support') return { patient: { role: { not: 'patient' } } };
  if (user.role === 'admin') {
    const roleMap: Record<string, string> = {
      doctor: 'doctor',
      staff: 'receptionist',
      patient: 'patient',
    };
    return { patient: { role: roleMap[userType] || 'patient' } };
  }
  if (user.role === 'doctor') {
    return {
      appointmentId: { not: null },
      category: { notIn: FORMAL_COMPLAINT_CATEGORIES },
      appointment: { slot: { doctor: { userId: user.id } } },
    };
  }
  if (user.role === 'receptionist') {
    const docIds = (await managedDoctorIds(user)) || [];
    return {
      appointmentId: { not: null },
      recipientId: user.id,
      appointment: { slot: { doctorId: { in: docIds } } },
    };
  }
  return { patientId: user.id };
}

export async function listRecipients(req: Request, res: Response) {
  const user = req.user!;
  const assigned = user.role === 'receptionist' ? await managedDoctorIds(user) : null;
  const rows = await prisma.user.findMany({ where: { id: { not: user.id }, isActive: true, OR: [
    { role: 'admin' },
    ...(user.isActive && (user.role === 'doctor' || user.role === 'admin') ? [{ role: { in: ['doctor', 'receptionist'] } }] : []),
    ...(user.isActive && assigned?.length ? [{ doctorProfile: { id: { in: assigned } } }] : []),
  ] }, select: { id: true, firstName: true, lastName: true, username: true, role: true }, orderBy: { firstName: 'asc' } });
  res.json({ recipients: rows.map((row) => ({ id: Number(row.id), name: userDisplayName(row), role: row.role })) });
}

export async function listComplaints(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const mode = String(req.query.mode || '').trim(); // 'mine' | 'queue'

  if (user.isActive && mode === 'queue' && ['admin', 'doctor', 'receptionist'].includes(user.role)) {
    const userTypeRaw = String(req.query.user_type || 'patient').toLowerCase();
    const userType = ['patient', 'doctor', 'staff', ...(user.role === 'admin' ? ['support'] : [])].includes(userTypeRaw) ? userTypeRaw : 'patient';

    const scopeWhere = await buildQueueScope(user, userType);
    const filters: Prisma.ComplaintWhereInput[] = [scopeWhere];

    const statusFilter = String(req.query.status || '').trim();
    if (['submitted', 'reviewing', 'resolved', 'approved', 'rejected'].includes(statusFilter)) {
      filters.push({ status: statusFilter });
    }

    const q = String(req.query.q || '').trim();
    if (q) {
      filters.push({
        OR: [
          { ticketCode: { contains: q, mode: 'insensitive' } },
          { subject: { contains: q, mode: 'insensitive' } },
          { message: { contains: q, mode: 'insensitive' } },
          { patient: { firstName: { contains: q, mode: 'insensitive' } } },
          { patient: { lastName: { contains: q, mode: 'insensitive' } } },
          { patient: { phone: { contains: q, mode: 'insensitive' } } },
          { appointment: { reference: { contains: q, mode: 'insensitive' } } },
        ],
      });
    }

    const sort = String(req.query.sort || 'newest') === 'oldest' ? 'oldest' : 'newest';
    const items = await prisma.complaint.findMany({
      where: { AND: filters },
      include: complaintInclude,
      orderBy: { createdAt: sort === 'oldest' ? 'asc' : 'desc' },
    });

    const baseWhere: Prisma.ComplaintWhereInput =
      user.role === 'doctor'
        ? {
            appointmentId: { not: null },
            category: { notIn: FORMAL_COMPLAINT_CATEGORIES },
            appointment: { slot: { doctor: { userId: user.id } } },
          }
        : user.role === 'receptionist'
          ? {
              appointmentId: { not: null },
              appointment: { slot: { doctorId: { in: (await managedDoctorIds(user)) || [] } } },
            }
          : {};

    const [patientCount, doctorCount, staffCount, allCount, subCount, revCount, resCount] =
      await Promise.all([
        prisma.complaint.count({ where: { ...baseWhere, patient: { role: 'patient' } } }),
        prisma.complaint.count({ where: { ...baseWhere, patient: { role: 'doctor' } } }),
        prisma.complaint.count({ where: { ...baseWhere, patient: { role: 'receptionist' } } }),
        prisma.complaint.count({ where: scopeWhere }),
        prisma.complaint.count({ where: { ...scopeWhere, status: 'submitted' } }),
        prisma.complaint.count({ where: { ...scopeWhere, status: 'reviewing' } }),
        prisma.complaint.count({ where: { ...scopeWhere, status: 'resolved' } }),
      ]);

    res.json({
      complaints: items.map(serializeComplaint),
      counts: {
        all: allCount,
        submitted: subCount,
        reviewing: revCount,
        resolved: resCount,
        patient: patientCount,
        doctor: doctorCount,
        staff: staffCount,
      },
      active_user_type: userType,
      active_status: statusFilter,
      sort,
    });
    return;
  }

  // Personal tickets list (Patient, Doctor, Receptionist)
  const items = await prisma.complaint.findMany({
    where: { OR: [{ patientId: user.id }, ...(user.role !== 'patient' ? [{ recipientId: user.id, patient: { role: { not: 'patient' } } }] : [])] },
    include: complaintInclude,
    orderBy: { createdAt: 'desc' },
  });

  let patientAppointments: ReturnType<typeof serializeAppointment>[] = [];
  if (user.role === 'patient' && user.isActive) {
    const appts = await prisma.appointment.findMany({
      where: {
        patientId: user.id,
      },
      include: {
        patient: true,
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
      orderBy: { createdAt: 'desc' },
      take: 30,
    });
    patientAppointments = appts.map(serializeAppointment);
  }

  res.json({
    complaints: items.map(serializeComplaint),
    patient_appointments: patientAppointments,
  });
}

export async function createComplaint(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  if (!['patient', 'doctor', 'receptionist'].includes(user.role)) {
    throw new HttpError(403, 'Administrators manage tickets from the Complaint Queue.');
  }

  const subject = String(req.body?.subject || '').trim();
  const message = String(req.body?.message || '').trim();
  if (!subject || !message) {
    throw new HttpError(400, 'Subject and inquiry details are required.');
  }
  if (subject.length > 150) {
    throw new HttpError(400, 'Subject must be 150 characters or fewer.');
  }

  const rawCategory = String(req.body?.category || 'support').trim();
  const issueCategories = ['cancel_appointment', 'reschedule', 'adjust_visit', 'payment_issue', 'refund_request', 'other_issue'];
  const internalCategories = ['assistance', 'internal_complaint', 'admin_request', 'technical', 'important_message'];
  const category = ['formal_complaint', 'doctor', 'hospital', 'staff', 'billing', 'other', ...issueCategories, ...(user.role !== 'patient' ? internalCategories : [])].includes(rawCategory)
    ? rawCategory
    : 'support';

  let appointmentId: bigint | null = null;
  const rawAppt = req.body?.appointment_id ?? req.body?.appointment;
  if (rawAppt && /^\d+$/.test(String(rawAppt)) && user.role === 'patient') {
    const appt = await prisma.appointment.findFirst({
      where: {
        id: BigInt(String(rawAppt)),
        patientId: user.id,
      },
      select: { id: true },
    });
    if (!appt) throw new HttpError(400, 'Selected appointment was not found for your account.');
    appointmentId = appt.id;
  }
  if (issueCategories.includes(category) && !appointmentId) throw new HttpError(400, 'Select an appointment for this issue.');
  let recipientId: bigint | null = null;
  if (user.role !== 'patient' && req.body?.recipient_id) {
    const raw = String(req.body.recipient_id);
    if (!/^\d+$/.test(raw)) throw new HttpError(400, 'Select an eligible recipient.');
    const candidate = await prisma.user.findFirst({ where: { id: BigInt(raw), isActive: true, role: { in: ['doctor', 'receptionist', 'admin'] } }, include: { doctorProfile: true } });
    const assigned = candidate?.doctorProfile && user.role === 'receptionist' && (await managedDoctorIds(user))?.includes(candidate.doctorProfile.id);
    if (!candidate || candidate.id === user.id || !(candidate.role === 'admin' || (user.isActive && (user.role === 'doctor' || assigned)))) {
      throw new HttpError(403, 'This recipient cannot receive your request.');
    }
    recipientId = candidate.id;
  }

  const ticketCode = await generateUniqueTicketCode();
  const attachment = req.file
    ? toRelativeMediaPath('complaints/patient', req.file.filename)
    : null;

  const created = await prisma.$transaction(async (tx) => {
    if (appointmentId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`complaint:${user.id}:${appointmentId}:${category}`}, 0))`;
      const open = await tx.complaint.findFirst({ where: { patientId: user.id, appointmentId, category, subject, message, status: { in: ['submitted', 'reviewing', 'approved'] } }, include: complaintInclude });
      if (open) return open;
    }
    const ticket = await tx.complaint.create({ data: {
      ticketCode,
      patientId: user.id,
      appointmentId,
      recipientId,
      subject,
      category,
      message,
      attachment,
      status: 'submitted',
      response: '',
    }, include: complaintInclude });
    if (category === 'refund_request' && appointmentId) {
      await tx.$queryRaw`SELECT id FROM hospital_appointment WHERE id = ${appointmentId} FOR UPDATE`;
      const appt = await tx.appointment.findUniqueOrThrow({ where: { id: appointmentId } });
      const original = await tx.paymentTransaction.findFirst({ where: { appointmentId, kind: 'charge', status: 'verified' } });
      if (original && ['paid', 'refund_pending'].includes(appt.paymentStatus)) {
        const fee = Number(original.amount);
        const penalty = appt.cancelModeSnapshot === 'fixed' ? Number(appt.cancelValueSnapshot) : round2(fee * Number(appt.cancelValueSnapshot) / 100);
        const amount = appt.status === 'cancelled' ? Math.max(0, round2(fee - penalty)) : fee;
        if (amount > 0) await tx.refundRequest.upsert({ where: { appointmentId }, update: {}, create: {
          appointmentId, amount, requestedById: user.id, reason: `Patient request ${ticket.ticketCode}`,
          mode: original.method === 'online' ? 'online' : 'cash', status: 'pending',
        } });
      }
    }
    await logAudit(user, 'complaint.submitted', Number(ticket.id), ticket.ticketCode, tx);
    return ticket;
  });
  const serialized = serializeComplaint(created);
  res.status(201).json({
    complaint: serialized,
    message: ['doctor', 'receptionist'].includes(user.role)
      ? `Your support request ${serialized.display_code} has been submitted to hospital administration.`
      : FORMAL_COMPLAINT_CATEGORIES.includes(category) || !appointmentId
        ? `Your submission ${serialized.display_code} has been sent to Hospital Administration.`
        : `Your support inquiry ${serialized.display_code} has been sent to your appointment doctor.`,
  });
}

async function visibleComplaint(user: NonNullable<Request['user']>, id: bigint) {
  const c = await prisma.complaint.findUnique({ where: { id }, include: complaintInclude });
  if (!c) throw new HttpError(404, 'Ticket not found.');

  const internalRecipient = c.recipientId === user.id && c.patient.role !== 'patient';
  if (!user.isActive && c.patientId !== user.id && !internalRecipient) throw new HttpError(403, 'Not authorized.');
  if (user.role === 'patient' && c.patientId !== user.id) {
    throw new HttpError(403, 'Not authorized.');
  }
  if (user.role === 'doctor') {
    const isOwner = c.patientId === user.id;
    const isDocAppt = c.appointment?.slot.doctor.userId === user.id && !FORMAL_COMPLAINT_CATEGORIES.includes(c.category);
    if (!isOwner && !internalRecipient && !isDocAppt) throw new HttpError(403, 'Not authorized.');
  }
  if (user.role === 'receptionist') {
    const docIds = (await managedDoctorIds(user)) || [];
    const isOwner = c.patientId === user.id;
    const isManagedAppt = c.appointment ? docIds.includes(c.appointment.slot.doctorId) : false;
    if (!isOwner && !internalRecipient && !(isManagedAppt && c.recipientId === user.id)) throw new HttpError(403, 'Not authorized.');
  }

  return c;
}

export async function getComplaint(req: Request, res: Response): Promise<void> {
  res.json({ complaint: serializeComplaint(await visibleComplaint(req.user!, BigInt(req.params.id))) });
}

export async function downloadAttachment(req: Request, res: Response): Promise<void> {
  const ticket = await visibleComplaint(req.user!, BigInt(req.params.id));
  const file = req.params.kind === 'response' ? ticket.adminAttachment : ticket.attachment;
  if (!file) throw new HttpError(404, 'Attachment not found.');
  const directory = path.join(env.mediaRoot, 'complaints', req.params.kind === 'response' ? 'admin' : 'patient');
  const filename = path.basename(file);
  res.setHeader('Cache-Control', 'private, no-store');
  res.download(path.join(directory, filename), filename);
}

export async function replyComplaint(req: Request, res: Response): Promise<void> {
  const id = BigInt(req.params.id);
  const c = await prisma.complaint.findUnique({ where: { id }, include: { patient: true } });
  if (!c) throw new HttpError(404, 'Ticket not found.');
  const actor = req.user!;
  if (c.patientId !== actor.id && !(c.recipientId === actor.id && c.patient.role !== 'patient') && !(actor.isActive && actor.role === 'admin')) throw new HttpError(403, 'Not authorized.');

  const text = String(req.body?.message || '').trim();
  if (!text) throw new HttpError(400, 'Please type a message before submitting.');

  await prisma.$transaction(async (tx) => {
    await tx.complaintMessage.create({ data: { complaintId: c.id, authorId: actor.id, message: text } });
    await tx.complaint.update({ where: { id: c.id }, data: { updatedAt: new Date() } });
    await logAudit(actor, 'complaint.patient_reply', Number(c.id), `Reply on #${c.id}`, tx);
  });

  const updated = await prisma.complaint.findUniqueOrThrow({
    where: { id: c.id },
    include: complaintInclude,
  });
  res.json({ complaint: serializeComplaint(updated), message: 'Your message has been sent.' });
}

export async function updateComplaint(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  if (!['admin', 'receptionist', 'doctor'].includes(user.role)) {
    throw new HttpError(403, 'Not authorized.');
  }

  const id = BigInt(req.params.id);
  const scopeWhere: Prisma.ComplaintWhereInput =
    user.role === 'doctor'
      ? {
          id,
          OR: [
            { category: { notIn: FORMAL_COMPLAINT_CATEGORIES }, appointment: { slot: { doctor: { userId: user.id } } } },
            { recipientId: user.id, patient: { role: { not: 'patient' } } },
          ],
        }
      : user.role === 'receptionist'
        ? {
            id,
            recipientId: user.id,
          }
        : { id };

  const existing = await prisma.complaint.findFirst({ where: scopeWhere });
  if (!existing) throw new HttpError(404, 'Ticket not found.');

  const newStatus = String(req.body?.status || '').trim();
  const responseNote = req.body?.response !== undefined ? String(req.body.response).trim() : '';
  const adminFile = req.file
    ? toRelativeMediaPath('complaints/admin', req.file.filename)
    : undefined;

  const data: Prisma.ComplaintUpdateInput = {
    updatedBy: { connect: { id: user.id } },
  };
  const financial = ['refund_request', 'payment_issue', 'billing', 'adjust_visit'].includes(existing.category);
  if (user.role !== 'admin' && financial && newStatus === 'resolved') throw new HttpError(403, 'Financial requests require administrative review.');
  if (['approved', 'rejected'].includes(newStatus) && user.role !== 'admin') throw new HttpError(403, 'An administrator must review this request.');
  if (req.body?.recipient_id !== undefined) {
    const raw = String(req.body.recipient_id);
    if (raw && !/^\d+$/.test(raw)) throw new HttpError(400, 'Select an eligible recipient.');
    if (raw) {
      const recipient = await prisma.user.findFirst({ where: { id: BigInt(raw), isActive: true, role: { in: ['doctor', 'receptionist', 'admin'] } } });
      if (!recipient || (financial && recipient.role !== 'admin')) throw new HttpError(400, 'Select an eligible recipient.');
      if (user.role !== 'admin' && (user.role !== 'doctor' || recipient.role !== 'admin')) throw new HttpError(403, 'Only administrators may assign a request to clinical staff.');
      if (existing.appointmentId && recipient.role !== 'admin') {
        const appointment = await prisma.appointment.findUniqueOrThrow({ where: { id: existing.appointmentId }, include: { slot: true } });
        if (!(await managedDoctorIds(recipient))?.includes(appointment.slot.doctorId)) throw new HttpError(400, 'The recipient must be assigned to this appointment.');
      }
      data.recipient = { connect: { id: recipient.id } };
    } else {
      if (user.role !== 'admin') throw new HttpError(403, 'Only administrators may clear an assignment.');
      data.recipient = { disconnect: true };
    }
  }
  if (adminFile) data.adminAttachment = adminFile;
  if (responseNote) data.response = responseNote;
  if (['submitted', 'reviewing', 'resolved', 'approved', 'rejected'].includes(newStatus)) {
    data.status = newStatus;
  }

  const updated = await prisma.$transaction(async (tx) => {
    if (responseNote) await tx.complaintMessage.create({ data: { complaintId: id, authorId: user.id, message: responseNote } });
    return tx.complaint.update({ where: { id }, data, include: complaintInclude });
  });

  const serialized = serializeComplaint(updated);
  if (['submitted', 'reviewing', 'resolved', 'approved', 'rejected'].includes(newStatus)) {
    await logAudit(
      user,
      newStatus === 'resolved' ? 'complaint.resolved' : 'complaint.updated',
      Number(updated.id),
      newStatus === 'resolved' ? `Issue solved on ${serialized.display_code}` : updated.status
    );
  }

  res.json({
    complaint: serialized,
    message: `Ticket ${serialized.display_code} updated successfully.`,
  });
}

export async function bulkComplaints(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  if (user.role !== 'admin') {
    throw new HttpError(403, 'Not authorized.');
  }

  const selectedRaw = Array.isArray(req.body?.selected_complaints)
    ? req.body.selected_complaints
    : [];
  const ids = selectedRaw
    .filter((x: unknown) => /^\d+$/.test(String(x)))
    .map((x: unknown) => BigInt(String(x)));
  if (!ids.length) {
    throw new HttpError(400, 'Please select at least one ticket to perform a bulk status update.');
  }

  const bulkStatus = String(req.body?.bulk_status || '').trim();
  if (!['submitted', 'reviewing', 'resolved'].includes(bulkStatus)) {
    throw new HttpError(400, 'Invalid status selected for bulk update.');
  }

  const tickets = await prisma.complaint.findMany({ where: { id: { in: ids } } });
  let count = 0;
  for (const t of tickets) {
    await prisma.complaint.update({
      where: { id: t.id },
      data: { status: bulkStatus, updatedById: user.id },
    });
    await logAudit(
      user,
      `complaint.bulk_${bulkStatus}`,
      Number(t.id),
      `Bulk status change to ${bulkStatus}`
    );
    count++;
  }

  const labels: Record<string, string> = {
    submitted: 'Generated',
    reviewing: 'Under Review & Inquiring',
    resolved: 'Issue Solved',
  };
  res.json({
    updated: count,
    message: `Successfully updated ${count} ticket(s) to "${labels[bulkStatus] || bulkStatus}".`,
  });
}
