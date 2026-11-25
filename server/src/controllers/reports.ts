import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import ExcelJS from 'exceljs';
import { prisma } from '../config/db.js';
import { appointmentScopeWhere, managedDoctorIds } from '../services/access.js';
import { ACTIVE_APPOINTMENT_STATUSES, collectedRevenueShares, round2 } from '../services/appointments.js';
import { logAudit } from '../services/audit.js';
import {
  serializeAppointment,
  serializeAuditEvent,
  serializeDoctor,
  userDisplayName,
} from '../services/serialize.js';
import { addDaysDate, dateToIso, localTodayDate, parseIsoDate, timeToHm } from '../utils/dateTime.js';

const appointmentInclude = {
  patient: true,
  createdBy: true,
  cancelledBy: true,
  payments: { include: { handledBy: true } },
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
};

export async function dashboard(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const today = localTodayDate();

  if (user.role === 'patient') {
    const [upcoming, history, upcomingCount, completedCount, complaintsCount] = await Promise.all([
      prisma.appointment.findMany({
        where: {
          patientId: user.id,
          status: { in: ['pending', 'confirmed'] },
          slot: { date: { gte: today } },
        },
        include: appointmentInclude,
        orderBy: [{ slot: { date: 'asc' } }, { slot: { startTime: 'asc' } }],
        take: 6,
      }),
      prisma.appointment.findMany({
        where: { patientId: user.id, status: 'completed' },
        include: appointmentInclude,
        orderBy: { createdAt: 'desc' },
        take: 4,
      }),
      prisma.appointment.count({
        where: {
          patientId: user.id,
          status: { in: ['pending', 'confirmed'] },
          slot: { date: { gte: today } },
        },
      }),
      prisma.appointment.count({ where: { patientId: user.id, status: 'completed' } }),
      prisma.complaint.count({ where: { patientId: user.id, status: { not: 'resolved' } } }),
    ]);

    res.json({
      role: 'patient',
      today: dateToIso(today),
      counts: {
        upcoming: upcomingCount,
        completed: completedCount,
        complaints: complaintsCount,
      },
      upcoming: upcoming.map(serializeAppointment),
      history: history.map(serializeAppointment),
    });
    return;
  }

  const docIds = await managedDoctorIds(user);
  const scope = appointmentScopeWhere(user, docIds);
  const thirtyDaysAgo = addDaysDate(today, -30);

  const [
    todayCount,
    upcomingCount,
    pendingCount,
    unpaidCount,
    refundsCount,
    paidAgg,
    todayAppointments,
    recentAppointments,
    todaySlots,
  ] = await Promise.all([
    prisma.appointment.count({
      where: {
        AND: [scope, { slot: { date: today }, status: { notIn: ['cancelled', 'expired'] } }],
      },
    }),
    prisma.appointment.count({
      where: {
        AND: [scope, { slot: { date: { gte: today } }, status: { in: ['pending', 'confirmed'] } }],
      },
    }),
    prisma.appointment.count({ where: { AND: [scope, { status: 'pending' }] } }),
    prisma.appointment.count({
      where: {
        AND: [scope, { paymentStatus: 'unpaid', status: { in: ['pending', 'confirmed'] } }],
      },
    }),
    prisma.refundRequest.count({
      where: {
        status: 'pending',
        ...(docIds !== null ? { appointment: { slot: { doctorId: { in: docIds } } } } : {}),
      },
    }),
    prisma.appointment.aggregate({
      where: {
        AND: [scope, { paymentStatus: 'paid', slot: { date: { gte: thirtyDaysAgo } } }],
      },
      _sum: { fee: true },
    }),
    prisma.appointment.findMany({
      where: {
        AND: [scope, { slot: { date: today }, status: { notIn: ['cancelled', 'expired'] } }],
      },
      include: appointmentInclude,
      orderBy: [{ slot: { startTime: 'asc' } }],
      take: 12,
    }),
    prisma.appointment.findMany({
      where: scope,
      include: appointmentInclude,
      orderBy: { createdAt: 'desc' },
      take: 6,
    }),
    prisma.appointmentSlot.findMany({
      where: {
        date: today,
        isOpen: true,
        ...(docIds !== null ? { doctorId: { in: docIds } } : {}),
      },
      include: {
        appointments: {
          where: { status: { in: ACTIVE_APPOINTMENT_STATUSES } },
          select: { id: true },
        },
      },
    }),
  ]);

  let spaces = 0;
  for (const s of todaySlots) {
    spaces += Math.max(0, s.capacity - s.appointments.length);
  }

  const counts: Record<string, number> = {
    today: todayCount,
    upcoming: upcomingCount,
    pending: pendingCount,
    unpaid: unpaidCount,
    refunds: refundsCount,
    collections: Number(paidAgg._sum.fee || 0),
    spaces,
  };

  if (user.role === 'admin') {
    const [doctors, patients, receptionists] = await Promise.all([
      prisma.doctorProfile.count({ where: { user: { isActive: true } } }),
      prisma.user.count({ where: { role: 'patient', isActive: true } }),
      prisma.user.count({ where: { role: 'receptionist', isActive: true } }),
    ]);
    counts.doctors = doctors;
    counts.patients = patients;
    counts.receptionists = receptionists;
  }

  res.json({
    role: user.role,
    today: dateToIso(today),
    counts,
    today_appointments: todayAppointments.map(serializeAppointment),
    recent_appointments: recentAppointments.map(serializeAppointment),
  });
}

async function getReportData(req: Request) {
  const user = req.user!;
  const allDocIds = await managedDoctorIds(user);
  const selectedDocRaw = String(req.query.doctor || '').trim();

  let targetDocIds = allDocIds;
  if (/^\d+$/.test(selectedDocRaw)) {
    const reqId = BigInt(selectedDocRaw);
    if (allDocIds === null) targetDocIds = [reqId];
    else targetDocIds = allDocIds.filter((id) => id === reqId);
  }

  const today = localTodayDate();
  let start = parseIsoDate(String(req.query.from || '')) || addDaysDate(today, -30);
  let end = parseIsoDate(String(req.query.to || '')) || today;
  if (start > end) {
    const tmp = start;
    start = end;
    end = tmp;
  }

  const where: Prisma.AppointmentWhereInput = {
    slot: {
      date: { gte: start, lte: end },
      ...(targetDocIds !== null ? { doctorId: { in: targetDocIds } } : {}),
    },
  };

  const apps = await prisma.appointment.findMany({
    where,
    include: appointmentInclude,
    orderBy: { createdAt: 'desc' },
  });

  const appIds = apps.map((a) => a.id);
  const [verifiedAgg, refundedAgg, shares, doctors] = await Promise.all([
    appIds.length
      ? prisma.paymentTransaction.aggregate({
          where: { appointmentId: { in: appIds }, kind: 'charge', status: 'verified' },
          _sum: { amount: true },
        })
      : Promise.resolve({ _sum: { amount: 0 } }),
    appIds.length
      ? prisma.paymentTransaction.aggregate({
          where: { appointmentId: { in: appIds }, kind: 'refund', status: 'refunded' },
          _sum: { amount: true },
        })
      : Promise.resolve({ _sum: { amount: 0 } }),
    collectedRevenueShares(apps),
    prisma.doctorProfile.findMany({
      where: allDocIds === null ? {} : { id: { in: allDocIds } },
      include: { user: true, department: true, chamber: true },
      orderBy: [{ user: { firstName: 'asc' } }],
    }),
  ]);

  const collected = Number(verifiedAgg._sum.amount || 0);
  const refunded = Number(refundedAgg._sum.amount || 0);

  return {
    start,
    end,
    selectedDoctor: selectedDocRaw,
    doctors,
    apps,
    report: {
      total: apps.length,
      completed: apps.filter((a) => a.status === 'completed').length,
      confirmed: apps.filter((a) => a.status === 'confirmed').length,
      cancelled: apps.filter((a) => a.status === 'cancelled').length,
      unpaid: apps.filter((a) => a.paymentStatus === 'unpaid').length,
      collected,
      refunded,
      net: round2(collected - refunded),
      hospital_cut: shares.hospital,
      doctor_cut: shares.doctor,
    },
  };
}

export async function reports(req: Request, res: Response): Promise<void> {
  const data = await getReportData(req);
  res.json({
    report: data.report,
    appointments: data.apps.slice(0, 50).map(serializeAppointment),
    doctors: data.doctors.map(serializeDoctor),
    from_date: dateToIso(data.start),
    to_date: dateToIso(data.end),
    selected_doctor: data.selectedDoctor,
  });
}

function safeExcel(value: unknown): string | number {
  if (typeof value === 'number') return value;
  const str = String(value ?? '');
  if (/^[=+\-@]/.test(str.trimStart())) {
    return `'${str}`;
  }
  return str;
}

export async function exportExcel(req: Request, res: Response): Promise<void> {
  const data = await getReportData(req);
  const workbook = new ExcelJS.Workbook();

  // Summary sheet first
  const ws = workbook.addWorksheet('Summary');
  ws.addRow(['GREEN HOSPITAL · OPERATIONS REPORT']);
  ws.addRow(['Period', `${dateToIso(data.start)} – ${dateToIso(data.end)}`]);
  ws.addRow(['Appointments', data.report.total]);
  ws.addRow(['Completed', data.report.completed]);
  ws.addRow(['Cancelled', data.report.cancelled]);
  ws.addRow(['Verified collections (BDT)', data.report.collected]);
  ws.addRow(['Paid refunds (BDT)', data.report.refunded]);
  ws.addRow(['Net collected (BDT)', data.report.net]);
  ws.addRow(['Hospital net share (BDT)', data.report.hospital_cut]);
  ws.addRow(['Doctor net share (BDT)', data.report.doctor_cut]);

  const apptSheet = workbook.addWorksheet('Appointments');
  apptSheet.addRow([
    'Reference',
    'Date',
    'Time',
    'Doctor',
    'Department',
    'Patient',
    'Phone',
    'Visit',
    'Status',
    'Payment',
    'Source',
    'Fee BDT',
    'Hospital Share',
    'Doctor Share',
    'Created',
  ]);
  for (const ap of data.apps) {
    const serialized = serializeAppointment(ap);
    apptSheet.addRow(
      [
        serialized.reference,
        serialized.slot.date,
        timeToHm(ap.slot.startTime),
        serialized.doctor.name,
        serialized.doctor.department?.name || 'General Consultation',
        serialized.patient_name,
        serialized.guest_phone,
        serialized.visit_type_display,
        serialized.status_display,
        serialized.payment_status_display,
        serialized.source_display,
        serialized.fee,
        serialized.hospital_cut,
        serialized.doctor_cut,
        ap.createdAt.toISOString().slice(0, 16).replace('T', ' '),
      ].map(safeExcel)
    );
  }

  const txSheet = workbook.addWorksheet('Transactions');
  txSheet.addRow([
    'Booking reference',
    'Type',
    'Method',
    'Status',
    'Amount BDT',
    'Processed',
    'Bank transaction',
    'Refund reference',
  ]);
  const appIds = data.apps.map((a) => a.id);
  const txs = appIds.length
    ? await prisma.paymentTransaction.findMany({
        where: { appointmentId: { in: appIds } },
        include: { appointment: { select: { reference: true } } },
        orderBy: { createdAt: 'desc' },
      })
    : [];
  for (const t of txs) {
    txSheet.addRow(
      [
        t.appointment.reference,
        t.kind,
        t.method,
        t.status,
        Number(t.amount),
        t.processedAt ? t.processedAt.toISOString().slice(0, 16).replace('T', ' ') : '',
        t.bankTransactionId,
        t.refundReference,
      ].map(safeExcel)
    );
  }

  for (const sheet of workbook.worksheets) {
    sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }];
    if (sheet.name !== 'Summary') {
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: Math.max(1, sheet.rowCount), column: sheet.columnCount },
      };
    }
    const headerRow = sheet.getRow(1);
    headerRow.eachCell((cell) => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF145B4B' } };
      cell.font = { name: 'Calibri', bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    });
    sheet.columns.forEach((col) => {
      let maxLen = 15;
      col.eachCell?.({ includeEmpty: false }, (cell, rowNum) => {
        if (rowNum <= 100) {
          maxLen = Math.max(maxLen, String(cell.value ?? '').length + 2);
        }
      });
      col.width = Math.min(38, maxLen);
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  await logAudit(
    req.user,
    'report.exported',
    'appointments',
    `${dateToIso(data.start)}–${dateToIso(data.end)}`
  );

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="green-hospital-report-${dateToIso(localTodayDate())}.xlsx"`
  );
  res.send(Buffer.from(buffer));
}

function buildAuditFilter(req: Request): Prisma.AuditEventWhereInput {
  const filters: Prisma.AuditEventWhereInput[] = [];
  const q = String(req.query.q || '').trim();
  if (q) {
    filters.push({
      OR: [
        { action: { contains: q, mode: 'insensitive' } },
        { target: { contains: q, mode: 'insensitive' } },
        { detail: { contains: q, mode: 'insensitive' } },
        { actor: { firstName: { contains: q, mode: 'insensitive' } } },
        { actor: { lastName: { contains: q, mode: 'insensitive' } } },
        { actor: { username: { contains: q, mode: 'insensitive' } } },
      ],
    });
  }

  const category = String(req.query.category || 'all').trim().toLowerCase();
  if (category === 'bookings' || category === 'booking') {
    filters.push({ action: { startsWith: 'appointment', mode: 'insensitive' } });
  } else if (category === 'payments') {
    filters.push({ action: { startsWith: 'payment', mode: 'insensitive' } });
  } else if (category === 'refunds') {
    filters.push({ action: { startsWith: 'refund', mode: 'insensitive' } });
  } else if (category === 'finance') {
    filters.push({
      OR: [
        { action: { startsWith: 'payment', mode: 'insensitive' } },
        { action: { startsWith: 'refund', mode: 'insensitive' } },
      ],
    });
  } else if (category === 'schedules' || category === 'schedule') {
    filters.push({
      OR: [
        { action: { startsWith: 'schedule', mode: 'insensitive' } },
        { action: { startsWith: 'slot', mode: 'insensitive' } },
      ],
    });
  } else if (category === 'staff') {
    filters.push({
      OR: [
        { action: { startsWith: 'staff', mode: 'insensitive' } },
        { action: { startsWith: 'doctor', mode: 'insensitive' } },
      ],
    });
  } else if (category === 'patients') {
    filters.push({
      OR: [
        { action: { startsWith: 'patient', mode: 'insensitive' } },
        { action: { startsWith: 'profile', mode: 'insensitive' } },
      ],
    });
  } else if (category === 'rooms') {
    filters.push({
      OR: [
        { action: { startsWith: 'room', mode: 'insensitive' } },
        { action: { startsWith: 'chamber', mode: 'insensitive' } },
      ],
    });
  } else if (category === 'departments') {
    filters.push({ action: { startsWith: 'department', mode: 'insensitive' } });
  } else if (category === 'complaints') {
    filters.push({ action: { startsWith: 'complaint', mode: 'insensitive' } });
  } else if (category === 'reports') {
    filters.push({ action: { startsWith: 'report', mode: 'insensitive' } });
  } else if (category === 'account') {
    filters.push({
      OR: [
        { action: { startsWith: 'patient', mode: 'insensitive' } },
        { action: { startsWith: 'staff', mode: 'insensitive' } },
        { action: { startsWith: 'profile', mode: 'insensitive' } },
      ],
    });
  } else if (category === 'management') {
    filters.push({
      OR: [
        { action: { startsWith: 'chamber', mode: 'insensitive' } },
        { action: { startsWith: 'room', mode: 'insensitive' } },
        { action: { startsWith: 'department', mode: 'insensitive' } },
        { action: { startsWith: 'hospital', mode: 'insensitive' } },
        { action: { startsWith: 'doctor', mode: 'insensitive' } },
        { action: { startsWith: 'complaint', mode: 'insensitive' } },
      ],
    });
  }

  const actorFilter = String(req.query.actor || 'all').trim().toLowerCase();
  if (actorFilter === 'system') {
    filters.push({ actorId: null });
  } else if (['admin', 'doctor', 'receptionist', 'patient'].includes(actorFilter)) {
    filters.push({ actor: { role: actorFilter } });
  }

  const dateFilter = String(req.query.date || 'all').trim().toLowerCase();
  const today = localTodayDate();
  if (dateFilter === 'today') {
    filters.push({ createdAt: { gte: today } });
  } else if (dateFilter === '2d') {
    filters.push({ createdAt: { gte: addDaysDate(today, -1) } });
  } else if (dateFilter === '7d') {
    filters.push({ createdAt: { gte: addDaysDate(today, -7) } });
  } else if (dateFilter === '30d') {
    filters.push({ createdAt: { gte: addDaysDate(today, -30) } });
  } else if (dateFilter === 'custom') {
    const fromParsed = parseIsoDate(String(req.query.from || ''));
    const toParsed = parseIsoDate(String(req.query.to || ''));
    if (fromParsed) {
      filters.push({ createdAt: { gte: fromParsed } });
    }
    if (toParsed) {
      filters.push({ createdAt: { lt: addDaysDate(toParsed, 1) } });
    }
  }

  return filters.length ? { AND: filters } : {};
}

export async function auditLog(req: Request, res: Response): Promise<void> {
  const where = buildAuditFilter(req);
  const page = Math.max(1, Number(req.query.page || 1) || 1);
  const limit = 30;
  const today = localTodayDate();

  const [totalFiltered, items, totalAll, bookingCount, financeCount, todayCount] = await Promise.all([
    prisma.auditEvent.count({ where }),
    prisma.auditEvent.findMany({
      where,
      include: { actor: true },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.auditEvent.count(),
    prisma.auditEvent.count({ where: { action: { startsWith: 'appointment', mode: 'insensitive' } } }),
    prisma.auditEvent.count({
      where: {
        OR: [
          { action: { startsWith: 'payment', mode: 'insensitive' } },
          { action: { startsWith: 'refund', mode: 'insensitive' } },
        ],
      },
    }),
    prisma.auditEvent.count({ where: { createdAt: { gte: today } } }),
  ]);

  res.json({
    events: items.map(serializeAuditEvent),
    total: totalFiltered,
    page,
    total_pages: Math.max(1, Math.ceil(totalFiltered / limit)),
    stats: {
      total: totalAll,
      today: todayCount,
      bookings: bookingCount,
      finance: financeCount,
    },
  });
}

function csvCell(val: string): string {
  const escaped = val.replace(/"/g, '""');
  return `"${escaped}"`;
}

export async function exportAuditCsv(req: Request, res: Response): Promise<void> {
  const where = buildAuditFilter(req);
  const items = await prisma.auditEvent.findMany({
    where,
    include: { actor: true },
    orderBy: { createdAt: 'desc' },
    take: 1000,
  });

  const rows = [
    ['Timestamp', 'Performer Name', 'Performer Role', 'Action Code', 'Action Label', 'Target Record', 'Details'],
  ];
  for (const e of items) {
    const s = serializeAuditEvent(e);
    const actorName = e.actor ? userDisplayName(e.actor) : 'System Automation';
    const actorRole = e.actor ? e.actor.role : 'system';
    rows.push([
      e.createdAt.toISOString().slice(0, 19).replace('T', ' '),
      actorName,
      actorRole,
      e.action,
      s.action_label,
      e.target,
      s.clean_detail,
    ]);
  }

  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="green_hospital_activity_log_${dateToIso(localTodayDate())}.csv"`
  );
  res.send(csv);
}
