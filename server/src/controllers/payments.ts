import type { Request, Response } from 'express';
import { prisma } from '../config/db.js';
import { appointmentScopeWhere, managedDoctorIds } from '../services/access.js';
import { serializePaymentTransaction, userDisplayName } from '../services/serialize.js';

export async function listPayments(req: Request, res: Response) {
  const actor = req.user!;
  const scope = appointmentScopeWhere(actor, await managedDoctorIds(actor));
  const doctor = { include: { user: true, department: true } } as const;
  const [transactions, unpaid] = await Promise.all([
    prisma.paymentTransaction.findMany({ where: { kind: 'charge', appointment: scope }, include: { appointment: { include: { slot: { include: { doctor } } } } }, orderBy: { createdAt: 'desc' } }),
    prisma.appointment.findMany({ where: { AND: [scope, { paymentStatus: 'unpaid', status: { in: ['pending', 'confirmed'] } }] }, include: { slot: { include: { doctor } } }, orderBy: { createdAt: 'desc' } }),
  ]);
  function booking(row: typeof unpaid[number]) {
    return { appointment_id: Number(row.id), reference: row.reference, patient: row.guestName, doctor: userDisplayName(row.slot.doctor.user), department: row.slot.doctor.department?.name || '' };
  }
  res.json({ rows: [
    ...transactions.map((row) => {
      const payment = serializePaymentTransaction(row);
      return { ...booking(row.appointment), id: payment.id, amount: payment.amount, method: payment.method_display, date: payment.processed_at || payment.created_at, status: payment.status, status_label: payment.status_display };
    }),
    ...unpaid.map((row) => ({ ...booking(row), id: null, amount: Number(row.fee), method: row.paymentMethod === 'cash' ? 'Cash' : 'Online', date: row.createdAt, status: 'unpaid', status_label: 'Unpaid' })),
  ] });
}
