import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import { HttpError } from '../middleware/error.js';
import { managedDoctorIds } from '../services/access.js';
import { generateUniqueTicketCode } from '../services/appointments.js';
import { logAudit } from '../services/audit.js';
import { serializeAppointment, serializeComplaint } from '../services/serialize.js';
import { toRelativeMediaPath } from '../utils/upload.js';

const complaintInclude = {
  patient: true,
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

async function buildQueueScope(user: NonNullable<Request['user']>, userType: string) {
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
      appointment: { slot: { doctor: { userId: user.id } } },
    };
  }
  if (user.role === 'receptionist') {
    const docIds = (await managedDoctorIds(user)) || [];
    return {
      appointmentId: { not: null },
      appointment: { slot: { doctorId: { in: docIds } } },
    };
  }
  return { patientId: user.id };
}

export async function listComplaints(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const mode = String(req.query.mode || '').trim(); // 'mine' | 'queue'

  if (mode === 'queue' && ['admin', 'doctor', 'receptionist'].includes(user.role)) {
    const userTypeRaw = String(req.query.user_type || 'patient').toLowerCase();
    const userType = ['patient', 'doctor', 'staff'].includes(userTypeRaw) ? userTypeRaw : 'patient';

    const scopeWhere = await buildQueueScope(user, userType);
    const filters: Prisma.ComplaintWhereInput[] = [scopeWhere];

    const statusFilter = String(req.query.status || '').trim();
    if (['submitted', 'reviewing', 'resolved'].includes(statusFilter)) {
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
      take: 400,
    });

    const baseWhere: Prisma.ComplaintWhereInput =
      user.role === 'doctor'
        ? { appointmentId: { not: null }, appointment: { slot: { doctor: { userId: user.id } } } }
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
    where: { patientId: user.id },
    include: complaintInclude,
    orderBy: { createdAt: 'desc' },
  });

  let patientAppointments: ReturnType<typeof serializeAppointment>[] = [];
  if (user.role === 'patient') {
    const appts = await prisma.appointment.findMany({
      where: {
        OR: [
          { patientId: user.id },
          ...(user.phone ? [{ guestPhone: user.phone }] : []),
        ],
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
  const category = ['doctor', 'hospital', 'staff', 'billing', 'other'].includes(rawCategory)
    ? rawCategory
    : 'support';

  let appointmentId: bigint | null = null;
  const rawAppt = req.body?.appointment_id ?? req.body?.appointment;
  if (rawAppt && /^\d+$/.test(String(rawAppt)) && user.role === 'patient') {
    const appt = await prisma.appointment.findFirst({
      where: {
        id: BigInt(String(rawAppt)),
        OR: [{ patientId: user.id }, ...(user.phone ? [{ guestPhone: user.phone }] : [])],
      },
      select: { id: true },
    });
    if (!appt) throw new HttpError(400, 'Selected appointment was not found for your account.');
    appointmentId = appt.id;
  }

  const ticketCode = await generateUniqueTicketCode();
  const attachment = req.file
    ? toRelativeMediaPath('complaints/patient', req.file.filename)
    : null;

  const created = await prisma.complaint.create({
    data: {
      ticketCode,
      patientId: user.id,
      appointmentId,
      subject,
      category,
      message,
      attachment,
      status: 'submitted',
      response: '',
    },
    include: complaintInclude,
  });

  await logAudit(user, 'complaint.submitted', Number(created.id), created.ticketCode);
  const serialized = serializeComplaint(created);
  res.status(201).json({
    complaint: serialized,
    message: ['doctor', 'receptionist'].includes(user.role)
      ? `Your support request ${serialized.display_code} has been submitted to hospital administration.`
      : `Your request/complaint ${serialized.display_code} has been generated. Updates will appear in your portal.`,
  });
}

export async function getComplaint(req: Request, res: Response): Promise<void> {
  const id = BigInt(req.params.id);
  const c = await prisma.complaint.findUnique({ where: { id }, include: complaintInclude });
  if (!c) throw new HttpError(404, 'Ticket not found.');

  const user = req.user!;
  if (user.role === 'patient' && c.patientId !== user.id) {
    throw new HttpError(403, 'Not authorized.');
  }
  if (user.role === 'doctor') {
    const isOwner = c.patientId === user.id;
    const isDocAppt = c.appointment?.slot.doctor.userId === user.id;
    if (!isOwner && !isDocAppt) throw new HttpError(403, 'Not authorized.');
  }
  if (user.role === 'receptionist') {
    const docIds = (await managedDoctorIds(user)) || [];
    const isOwner = c.patientId === user.id;
    const isManagedAppt = c.appointment ? docIds.includes(c.appointment.slot.doctorId) : false;
    if (!isOwner && !isManagedAppt) throw new HttpError(403, 'Not authorized.');
  }

  res.json({ complaint: serializeComplaint(c) });
}

export async function replyComplaint(req: Request, res: Response): Promise<void> {
  const id = BigInt(req.params.id);
  const c = await prisma.complaint.findUnique({ where: { id } });
  if (!c) throw new HttpError(404, 'Ticket not found.');
  if (c.patientId !== req.user!.id) throw new HttpError(403, 'Not authorized.');

  const text = String(req.body?.message || '').trim();
  if (!text) throw new HttpError(400, 'Please type a message before submitting.');

  await prisma.complaintMessage.create({
    data: { complaintId: c.id, authorId: req.user!.id, message: text },
  });
  await prisma.complaint.update({ where: { id: c.id }, data: { updatedAt: new Date() } });
  await logAudit(req.user, 'complaint.patient_reply', Number(c.id), `Reply on #${c.id}`);

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
  const scopeWhere =
    user.role === 'doctor'
      ? { id, appointmentId: { not: null }, appointment: { slot: { doctor: { userId: user.id } } } }
      : user.role === 'receptionist'
        ? {
            id,
            appointmentId: { not: null },
            appointment: { slot: { doctorId: { in: (await managedDoctorIds(user)) || [] } } },
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
  if (adminFile) data.adminAttachment = adminFile;
  if (responseNote) data.response = responseNote;
  if (['submitted', 'reviewing', 'resolved'].includes(newStatus)) {
    data.status = newStatus;
  }

  const updated = await prisma.complaint.update({
    where: { id },
    data,
    include: complaintInclude,
  });

  const serialized = serializeComplaint(updated);
  if (['submitted', 'reviewing', 'resolved'].includes(newStatus)) {
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
  if (!['admin', 'receptionist', 'doctor'].includes(user.role)) {
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

  const scopeWhere: Prisma.ComplaintWhereInput =
    user.role === 'doctor'
      ? {
          id: { in: ids },
          appointmentId: { not: null },
          appointment: { slot: { doctor: { userId: user.id } } },
        }
      : user.role === 'receptionist'
        ? {
            id: { in: ids },
            appointmentId: { not: null },
            appointment: { slot: { doctorId: { in: (await managedDoctorIds(user)) || [] } } },
          }
        : { id: { in: ids } };

  const tickets = await prisma.complaint.findMany({ where: scopeWhere });
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
