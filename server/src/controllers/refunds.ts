import type { Request, Response } from 'express';
import type { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import { HttpError } from '../middleware/error.js';
import { managedDoctorIds } from '../services/access.js';
import {
  approveRefund,
  finalizeCashRefund,
  rejectRefund,
  submitOnlineRefund,
} from '../services/refunds.js';
import { serializeRefundRequest } from '../services/serialize.js';

const refundInclude = {
  requestedBy: true,
  reviewedBy: true,
  appointment: {
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
  },
};

export async function listRefunds(req: Request, res: Response): Promise<void> {
  const docIds = await managedDoctorIds(req.user!);
  const filters: Prisma.RefundRequestWhereInput[] = [];
  if (docIds !== null) {
    filters.push({ appointment: { slot: { doctorId: { in: docIds } } } });
  }

  const status = String(req.query.status || '').trim();
  if (['pending', 'approved', 'processing', 'completed', 'rejected'].includes(status)) {
    filters.push({ status });
  }

  const keyword = String(req.query.q || '').trim();
  if (keyword) {
    filters.push({
      OR: [
        { appointment: { reference: { contains: keyword, mode: 'insensitive' } } },
        { appointment: { guestName: { contains: keyword, mode: 'insensitive' } } },
        { appointment: { guestPhone: { contains: keyword, mode: 'insensitive' } } },
        { appointment: { slot: { doctor: { user: { firstName: { contains: keyword, mode: 'insensitive' } } } } } },
        { appointment: { slot: { doctor: { user: { lastName: { contains: keyword, mode: 'insensitive' } } } } } },
      ],
    });
  }

  const sort = String(req.query.sort || 'newest');
  let orderBy: Prisma.RefundRequestOrderByWithRelationInput[];
  if (sort === 'oldest') orderBy = [{ createdAt: 'asc' }, { id: 'asc' }];
  else if (sort === 'amount_high') orderBy = [{ amount: 'desc' }, { id: 'asc' }];
  else if (sort === 'amount_low') orderBy = [{ amount: 'asc' }, { id: 'asc' }];
  else orderBy = [{ createdAt: 'desc' }, { id: 'asc' }];

  const page = Math.max(1, Number(req.query.page || 1) || 1);
  const limit = 25;
  const where: Prisma.RefundRequestWhereInput = filters.length ? { AND: filters } : {};

  const [total, items] = await Promise.all([
    prisma.refundRequest.count({ where }),
    prisma.refundRequest.findMany({
      where,
      include: refundInclude,
      orderBy,
      skip: (page - 1) * limit,
      take: limit,
    }),
  ]);

  res.json({
    refunds: items.map(serializeRefundRequest),
    total,
    page,
    total_pages: Math.max(1, Math.ceil(total / limit)),
  });
}

export async function bulkApprove(req: Request, res: Response): Promise<void> {
  const selectedRaw = Array.isArray(req.body?.selected) ? req.body.selected : [];
  const ids = selectedRaw
    .filter((x: unknown) => /^\d+$/.test(String(x)))
    .slice(0, 200)
    .map((x: unknown) => BigInt(String(x)));

  const docIds = await managedDoctorIds(req.user!);
  const allowedRows = await prisma.refundRequest.findMany({
    where: {
      id: { in: ids },
      ...(docIds !== null ? { appointment: { slot: { doctorId: { in: docIds } } } } : {}),
    },
    select: { id: true },
  });

  let count = 0;
  let fail = 0;
  for (const r of allowedRows) {
    try {
      await approveRefund(r.id, req.user!);
      count++;
    } catch {
      fail++;
    }
  }

  res.json({
    approved: count,
    failed: fail,
    message: count
      ? `${count} refunds approved. Complete cash payouts or submit online refunds separately.`
      : 'No refunds could be approved.',
  });
}

export async function approve(req: Request, res: Response): Promise<void> {
  const id = BigInt(req.params.id);
  const updated = await approveRefund(id, req.user!);
  const full = await prisma.refundRequest.findUniqueOrThrow({
    where: { id: updated.id },
    include: refundInclude,
  });
  res.json({
    refund: serializeRefundRequest(full),
    message: 'Refund approved. Complete the corresponding payout next.',
  });
}

export async function cashPayout(req: Request, res: Response): Promise<void> {
  const id = BigInt(req.params.id);
  const updated = await finalizeCashRefund(id, req.user!);
  const full = await prisma.refundRequest.findUniqueOrThrow({
    where: { id: updated.id },
    include: refundInclude,
  });
  res.json({
    refund: serializeRefundRequest(full),
    message: 'Cash refund recorded as paid to the patient.',
  });
}

export async function onlineSubmit(req: Request, res: Response): Promise<void> {
  const id = BigInt(req.params.id);
  const updated = await submitOnlineRefund(id, req.user!);
  const full = await prisma.refundRequest.findUniqueOrThrow({
    where: { id: updated.id },
    include: refundInclude,
  });
  res.json({
    refund: serializeRefundRequest(full),
    message: 'Gateway accepted the refund request. Final payout is awaiting gateway confirmation.',
  });
}

export async function reject(req: Request, res: Response): Promise<void> {
  const id = BigInt(req.params.id);
  const note = String(req.body?.note || '');
  const updated = await rejectRefund(id, req.user!, note);
  const full = await prisma.refundRequest.findUniqueOrThrow({
    where: { id: updated.id },
    include: refundInclude,
  });
  res.json({
    refund: serializeRefundRequest(full),
    message: 'Refund request rejected.',
  });
}

export { HttpError };
