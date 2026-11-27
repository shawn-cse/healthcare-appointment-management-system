import type { User } from '@prisma/client';
import { prisma } from '../config/db.js';
import { HttpError } from '../middleware/error.js';
import { doctorAllowed } from './access.js';
import { logAudit } from './audit.js';
import { gatewayRefund } from './gateway.js';

export async function approveRefund(refundId: bigint, actor: User) {
  if (!actor.isActive || actor.role !== 'admin') throw new HttpError(403, 'Only an active administrator can approve refunds.');
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM hospital_refundrequest WHERE id = ${refundId} FOR UPDATE
    `;
    if (!locked.length) throw new HttpError(404, 'Refund request not found.');

    const refund = await tx.refundRequest.findUniqueOrThrow({
      where: { id: refundId },
      include: { appointment: { include: { slot: { include: { doctor: true } } } } },
    });

    if (refund.status !== 'pending') {
      throw new HttpError(400, 'Only pending requests may be approved.');
    }

    const updated = await tx.refundRequest.update({
      where: { id: refund.id },
      data: {
        status: 'approved',
        reviewedById: actor.id,
        reviewedAt: new Date(),
      },
    });
    await tx.complaint.updateMany({ where: { appointmentId: refund.appointmentId, category: 'refund_request', status: { in: ['submitted', 'reviewing'] } }, data: { status: 'approved', updatedById: actor.id } });

    await logAudit(
      actor,
      'refund.approved',
      refund.appointment.reference,
      Number(refund.amount).toFixed(2),
      tx
    );
    return updated;
  });
}

export async function finalizeCashRefund(refundId: bigint, actor: User, reference = '') {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM hospital_refundrequest WHERE id = ${refundId} FOR UPDATE
    `;
    if (!locked.length) throw new HttpError(404, 'Refund request not found.');

    const refund = await tx.refundRequest.findUniqueOrThrow({
      where: { id: refundId },
      include: { appointment: { include: { slot: { include: { doctor: true } } } } },
    });

    const allowed = await doctorAllowed(actor, refund.appointment.slot.doctor, tx);
    if (!['admin', 'receptionist'].includes(actor.role) || !allowed) {
      throw new HttpError(403, 'Not authorized.');
    }
    if (refund.mode !== 'cash' || refund.status !== 'approved') {
      throw new HttpError(400, 'Only approved cash refunds can be marked paid out.');
    }

    const now = new Date();
    const updated = await tx.refundRequest.update({
      where: { id: refund.id },
      data: { status: 'completed', completedAt: now },
    });

    const appt = refund.appointment;
    const nextPayStatus =
      Number(refund.amount) >= Number(appt.fee) ? 'refunded' : 'partially_refunded';

    await tx.appointment.update({
      where: { id: appt.id },
      data: { paymentStatus: nextPayStatus },
    });

    await tx.paymentTransaction.create({
      data: {
        appointmentId: appt.id,
        kind: 'refund',
        method: 'cash',
        status: 'refunded',
        amount: refund.amount,
        refundReference: reference,
        handledById: actor.id,
        processedAt: now,
      },
    });
    await tx.complaint.updateMany({ where: { appointmentId: appt.id, category: 'refund_request', status: { in: ['submitted', 'reviewing', 'approved'] } }, data: { status: 'resolved', response: 'The refund has been paid at reception.', updatedById: actor.id } });

    await logAudit(
      actor,
      'refund.cash_disbursed',
      appt.reference,
      Number(refund.amount).toFixed(2),
      tx
    );
    return updated;
  });
}

export async function submitOnlineRefund(refundId: bigint, actor: User) {
  const prep = await prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM hospital_refundrequest WHERE id = ${refundId} FOR UPDATE
    `;
    if (!locked.length) throw new HttpError(404, 'Refund request not found.');

    const refund = await tx.refundRequest.findUniqueOrThrow({
      where: { id: refundId },
      include: {
        appointment: {
          include: {
            slot: { include: { doctor: true } },
            payments: {
              where: { kind: 'charge', method: 'online', status: 'verified' },
              take: 1,
            },
          },
        },
      },
    });

    const allowed = await doctorAllowed(actor, refund.appointment.slot.doctor, tx);
    if (!['admin', 'receptionist'].includes(actor.role) || !allowed) {
      throw new HttpError(403, 'Not authorized.');
    }
    if (refund.status !== 'approved' || refund.mode !== 'online') {
      throw new HttpError(400, 'Only approved online refunds can be submitted.');
    }
    const charge = refund.appointment.payments[0];
    if (!charge || !charge.bankTransactionId) {
      throw new HttpError(
        400,
        'Verified bank transaction reference is required for an online refund.'
      );
    }

    await tx.refundRequest.update({
      where: { id: refund.id },
      data: { status: 'processing' },
    });

    return {
      refundId: refund.id,
      appointmentId: refund.appointmentId,
      reference: refund.appointment.reference,
      amount: Number(refund.amount),
      bankTransactionId: charge.bankTransactionId,
    };
  });

  let externalId: string;
  try {
    externalId = await gatewayRefund(prep.bankTransactionId, prep.amount, prep.reference);
  } catch (err) {
    await prisma.refundRequest.updateMany({
      where: { id: prep.refundId, status: 'processing' },
      data: { status: 'approved' },
    });
    if (err instanceof HttpError) throw err;
    throw new HttpError(
      400,
      'Gateway refund could not be initiated. Please verify the transaction before retrying.'
    );
  }

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`
      SELECT id FROM hospital_refundrequest WHERE id = ${prep.refundId} FOR UPDATE
    `;
    const refund = await tx.refundRequest.findUniqueOrThrow({ where: { id: prep.refundId } });
    await tx.paymentTransaction.create({
      data: {
        appointmentId: prep.appointmentId,
        kind: 'refund',
        method: 'online',
        status: 'processing',
        amount: refund.amount,
        refundReference: externalId,
        handledById: actor.id,
      },
    });
    await logAudit(actor, 'refund.gateway_submitted', prep.reference, externalId, tx);
    return refund;
  });
}

export async function rejectRefund(refundId: bigint, actor: User, note = '') {
  return prisma.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: bigint }>>`
      SELECT id FROM hospital_refundrequest WHERE id = ${refundId} FOR UPDATE
    `;
    if (!locked.length) throw new HttpError(404, 'Refund request not found.');

    const refund = await tx.refundRequest.findUniqueOrThrow({
      where: { id: refundId },
      include: { appointment: { include: { slot: { include: { doctor: true } } } } },
    });

    const allowed = await doctorAllowed(actor, refund.appointment.slot.doctor, tx);
    if (!['admin', 'receptionist'].includes(actor.role) || !allowed) {
      throw new HttpError(403, 'Not authorized.');
    }
    if (!['pending', 'approved'].includes(refund.status)) {
      throw new HttpError(400, 'Only pending or approved refund requests can be rejected.');
    }

    const updated = await tx.refundRequest.update({
      where: { id: refund.id },
      data: {
        status: 'rejected',
        reviewedById: actor.id,
        reviewedAt: new Date(),
        internalNote: note,
      },
    });

    await tx.appointment.update({
      where: { id: refund.appointmentId },
      data: { paymentStatus: 'paid' },
    });

    await logAudit(actor, 'refund.rejected', refund.appointment.reference, note, tx);
    return updated;
  });
}
