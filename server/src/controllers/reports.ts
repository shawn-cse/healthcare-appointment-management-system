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
  serializePaymentTransaction,
  userDisplayName,
} from '../services/serialize.js';
import { addDaysDate, dateToIso, localStartUtc, localTodayDate, parseIsoDate, parseTimeStr, timeToHm } from '../utils/dateTime.js';

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

function transactionHospitalShare(amount: number, fee: number, cut: number, charge: boolean) {
  return fee > 0 ? (charge ? Math.round(amount * cut / fee) : Math.round((fee - amount) * cut / fee) - cut) : 0;
}

async function adminDashboard(today: Date) {
  const midnight = parseTimeStr('00:00')!;
  const bounds = [0, -6, -29].map((offset) => localStartUtc(addDaysDate(today, offset), midnight));
  const [queue, total, paid, unpaid, transactions] = await Promise.all([
    prisma.appointment.findMany({
      where: { slot: { date: today }, status: { notIn: ['cancelled', 'expired'] } },
      include: appointmentInclude,
      orderBy: [{ slot: { startTime: 'asc' } }, { serialNumber: 'asc' }, { id: 'asc' }],
    }),
    prisma.appointment.count(),
    prisma.appointment.count({ where: { paymentStatus: { in: ['paid', 'partially_refunded'] } } }),
    prisma.appointment.count({ where: { paymentStatus: 'unpaid', status: { in: ['pending', 'confirmed'] } } }),
    prisma.paymentTransaction.findMany({
      where: {
        processedAt: { gte: bounds[2], lt: localStartUtc(addDaysDate(today, 1), midnight) },
        OR: [{ kind: 'charge', status: 'verified' }, { kind: 'refund', status: 'refunded' }],
      },
      select: { amount: true, kind: true, processedAt: true, appointment: { select: { fee: true, hospitalCut: true } } },
    }),
  ]);
  const todayPatients = new Set(queue.map((row) => row.patientId ? `patient:${row.patientId}` : row.guestPhone ? `phone:${row.guestPhone}` : `booking:${row.id}`));
  const revenue = bounds.map((start) => transactions.reduce((sum, row) => {
    if (!row.processedAt || row.processedAt < start) return sum;
    return sum + transactionHospitalShare(Math.round(Number(row.amount) * 100), Math.round(Number(row.appointment.fee) * 100), Math.round(Number(row.appointment.hospitalCut) * 100), row.kind === 'charge');
  }, 0) / 100);
  return {
    role: 'admin', today: dateToIso(today), notifications: [],
    counts: { today: todayPatients.size, total, paid, unpaid, revenue_today: revenue[0], revenue_7_days: revenue[1], revenue_30_days: revenue[2] },
    today_appointments: queue.map(serializeAppointment),
  };
}

export async function dashboard(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const today = localTodayDate();
  if (user.role === 'admin') {
    res.json(await adminDashboard(today));
    return;
  }
  const docIds = await managedDoctorIds(user);
  const scope = appointmentScopeWhere(user, docIds);
  const complaintScope: Prisma.ComplaintWhereInput = user.role === 'patient' ? { patientId: user.id } : {
    OR: [{ patientId: user.id }, { recipientId: user.id }, ...(user.role === 'doctor' ? [{ appointment: scope }] : [])],
  };
  const [recentBookings, recentTickets, recentRefunds] = await Promise.all([
    prisma.appointment.findMany({ where: scope, orderBy: { updatedAt: 'desc' }, take: 15, select: { id: true, reference: true, status: true, updatedAt: true, paymentStatus: true } }),
    prisma.complaint.findMany({ where: complaintScope, orderBy: { updatedAt: 'desc' }, take: 15, select: { id: true, subject: true, status: true, updatedAt: true } }),
    prisma.refundRequest.findMany({ where: { appointment: scope, ...(user.role === 'receptionist' ? { status: { in: ['approved', 'processing', 'completed'] } } : {}) }, orderBy: { createdAt: 'desc' }, take: 15, select: { id: true, status: true, createdAt: true, completedAt: true, reviewedAt: true, appointment: { select: { id: true, reference: true } } } }),
  ]);
  const notifications = [
    ...recentBookings.map((item) => ({ id: `appointment-${item.id}`, link: `/appointments/${item.id}`, label: `Appointment ${item.reference} · ${item.status.replaceAll('_', ' ')}`, date: item.updatedAt })),
    ...recentTickets.map((item) => ({ id: `complaint-${item.id}`, link: `/complaints/${item.id}`, label: `${item.subject} · ${item.status}`, date: item.updatedAt })),
    ...recentRefunds.map((item) => ({ id: `refund-${item.id}`, link: `/appointments/${item.appointment.id}`, label: `Refund for ${item.appointment.reference} · ${item.status}`, date: item.completedAt ?? item.reviewedAt ?? item.createdAt })),
  ].sort((a, b) => +b.date - +a.date);

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
      notifications,
      unpaid_appointments: (await prisma.appointment.findMany({ where: { patientId: user.id, paymentStatus: 'unpaid', status: { in: ['pending', 'confirmed'] } }, include: appointmentInclude, orderBy: { createdAt: 'desc' }, take: 10 })).map(serializeAppointment),
    });
    return;
  }

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
        status: user.role === 'receptionist' ? 'approved' : 'pending',
        ...(docIds !== null ? { appointment: { slot: { doctorId: { in: docIds } } } } : {}),
      },
    }),
    prisma.paymentTransaction.aggregate({
      where: {
        appointment: scope, kind: 'charge', status: 'verified', processedAt: { gte: localStartUtc(thirtyDaysAgo, parseTimeStr('00:00')!) },
      },
      _sum: { amount: true },
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
    collections: Number(paidAgg._sum.amount || 0),
    spaces,
  };
  const [completed, cancelled, pendingComplaints, supportCount, earningRows, assignedDoctors] = await Promise.all([
    prisma.appointment.count({ where: { AND: [scope, { status: 'completed' }] } }),
    prisma.appointment.count({ where: { AND: [scope, { status: 'cancelled' }] } }),
    prisma.complaint.count({ where: { AND: [complaintScope, { status: { in: ['submitted', 'reviewing', 'approved'] }, patient: { role: 'patient' } }] } }),
    prisma.complaint.count({ where: { AND: [complaintScope, { status: { in: ['submitted', 'reviewing'] }, patient: { role: { not: 'patient' } } }] } }),
    prisma.appointment.findMany({ where: scope, select: { id: true, fee: true, hospitalCut: true } }),
    prisma.doctorProfile.findMany({ where: { id: { in: docIds ?? [] } }, include: { user: true, department: true, chamber: true, receptionists: { include: { user: true } }, weekly: true } }),
  ]);
  const shares = await collectedRevenueShares(earningRows);
  Object.assign(counts, { completed, cancelled, complaints: pendingComplaints, support: supportCount, hospital_revenue: shares.hospital, doctor_earnings: shares.doctor });


  res.json({
    role: user.role,
    today: dateToIso(today),
    counts,
    notifications,
    assigned_doctors: assignedDoctors.map(serializeDoctor),
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

  const department = String(req.query.department || '');
  const visit = String(req.query.visit_type || '');
  const method = String(req.query.payment_method || '');
  const status = String(req.query.status || '');
  const scope: Prisma.AppointmentWhereInput = {
    slot: {
      ...(targetDocIds !== null ? { doctorId: { in: targetDocIds } } : {}),
      ...(/^\d+$/.test(department) ? { doctor: { departmentId: BigInt(department) } } : {}),
    },
    ...(['first', 'followup', 'report'].includes(visit) ? { visitType: visit } : {}),
    ...(['pending', 'confirmed', 'completed', 'cancelled', 'no_show', 'expired'].includes(status) ? { status } : {}),
  };
  const midnight = parseTimeStr('00:00')!;
  const [apps, transactions, doctors] = await Promise.all([
    prisma.appointment.findMany({ where: { AND: [scope, { slot: { date: { gte: start, lte: end } }, ...(['cash', 'online'].includes(method) ? { paymentMethod: method } : {}) }] }, include: appointmentInclude, orderBy: [{ slot: { date: 'desc' } }, { id: 'desc' }] }),
    prisma.paymentTransaction.findMany({ where: {
      appointment: scope,
      processedAt: { gte: localStartUtc(start, midnight), lt: localStartUtc(addDaysDate(end, 1), midnight) },
      OR: [{ kind: 'charge', status: 'verified' }, { kind: 'refund', status: 'refunded' }],
      ...(['cash', 'online', 'bank'].includes(method) ? { method } : {}),
    }, include: { appointment: { include: { slot: { include: { doctor: { include: { user: true, department: true } } } } } } }, orderBy: [{ processedAt: 'desc' }, { id: 'desc' }] }),
    prisma.doctorProfile.findMany({
      where: allDocIds === null ? {} : { id: { in: allDocIds } },
      include: { user: true, department: true, chamber: true },
      orderBy: [{ user: { firstName: 'asc' } }],
    }),
  ]);

  let collected = 0, refunded = 0, hospital = 0;
  const financialRows = transactions.map((transaction) => {
    const amount = Math.round(Number(transaction.amount) * 100);
    const fee = Math.round(Number(transaction.appointment.fee) * 100);
    const cut = Math.round(Number(transaction.appointment.hospitalCut) * 100);
    const charge = transaction.kind === 'charge';
    if (charge) collected += amount;
    else refunded += amount;
    const share = transactionHospitalShare(amount, fee, cut, charge);
    hospital += share;
    return {
      ...serializePaymentTransaction(transaction),
      reference: transaction.appointment.reference,
      doctor_id: Number(transaction.appointment.slot.doctorId),
      doctor: userDisplayName(transaction.appointment.slot.doctor.user),
      department: transaction.appointment.slot.doctor.department?.name || '',
      hospital: share / 100,
      doctor_earnings: ((charge ? amount : -amount) - share) / 100,
    };
  });

  return {
    start,
    end,
    selectedDoctor: selectedDocRaw,
    doctors,
    apps,
    financialRows,
    report: {
      total: apps.length,
      completed: apps.filter((a) => a.status === 'completed').length,
      confirmed: apps.filter((a) => a.status === 'confirmed').length,
      cancelled: apps.filter((a) => a.status === 'cancelled').length,
      unpaid: apps.filter((a) => a.paymentStatus === 'unpaid').length,
      collected: collected / 100,
      refunded: refunded / 100,
      net: (collected - refunded) / 100,
      hospital_cut: hospital / 100,
      doctor_cut: (collected - refunded - hospital) / 100,
    },
  };
}

export async function reports(req: Request, res: Response): Promise<void> {
  const data = await getReportData(req);
  res.json({
    report: data.report,
    appointments: data.apps.map(serializeAppointment),
    transactions: data.financialRows,
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

  const transactions = workbook.addWorksheet('Financial Transactions');
  transactions.addRow(['Payment ID', 'Appointment', 'Doctor', 'Department', 'Type', 'Method', 'Transaction date', 'Amount BDT', 'Hospital BDT', 'Doctor BDT']);
  for (const entry of data.financialRows) transactions.addRow([entry.id, entry.reference, entry.doctor, entry.department, entry.kind_display, entry.method_display, entry.processed_at, entry.amount, entry.hospital, entry.doctor_earnings].map(safeExcel));
  transactions.getRow(1).font = { bold: true };
  transactions.views = [{ state: 'frozen', ySplit: 1 }];

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
  const limit = Math.min(100, Math.max(1, Math.trunc(Number(req.query.limit) || 30)));
  const [field, rawDirection] = String(req.query.sort || 'date.desc').split('.');
  const direction = rawDirection === 'asc' ? 'asc' as const : 'desc' as const;
  const order: Record<string, Prisma.AuditEventOrderByWithRelationInput> = {
    date: { createdAt: direction }, actor: { actor: { firstName: direction } },
    action: { action: direction }, target: { target: direction }, detail: { detail: direction },
  };
  const today = localTodayDate();

  const [totalFiltered, items, totalAll, bookingCount, financeCount, todayCount] = await Promise.all([
    prisma.auditEvent.count({ where }),
    prisma.auditEvent.findMany({
      where,
      include: { actor: true },
      orderBy: [Object.hasOwn(order, field) ? order[field] : order.date, { id: 'desc' }],
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
