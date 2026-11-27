import type { NextFunction, Request, Response } from 'express';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { HttpError } from '../middleware/error.js';
import { managedDoctorIds } from '../services/access.js';
import {
  approveRefund,
  finalizeCashRefund,
  rejectRefund,
  submitOnlineRefund,
} from '../services/refunds.js';
import { serializeRefundRequest } from '../services/serialize.js';
import { logAudit } from '../services/audit.js';

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

async function editableRefund(req: Request) {
  if (!/^\d+$/.test(req.params.id)) throw new HttpError(404, 'Refund request not found.');
  const doctorIds = await managedDoctorIds(req.user!);
  const where: Prisma.RefundRequestWhereInput = { id: BigInt(req.params.id), ...(doctorIds !== null ? {
    appointment: { slot: { doctorId: { in: doctorIds } } }, status: { in: ['approved', 'processing', 'completed'] },
  } : {}) };
  const refund = await prisma.refundRequest.findFirst({ where });
  if (!refund) throw new HttpError(404, 'Refund request not found.');
  return { refund, where };
}

export async function allowEvidenceUpload(req: Request, _res: Response, next: NextFunction) {
  await editableRefund(req);
  next();
}

export async function saveEvidence(req: Request, res: Response) {
  const { refund, where } = await editableRefund(req);
  const note = typeof req.body?.note === 'string' ? req.body.note.trim() : undefined;
  if (note !== undefined && note.length > 3000) throw new HttpError(400, 'Refund notes are limited to 3000 characters.');
  if (note === undefined && !req.file) throw new HttpError(400, 'Enter a note or attach a document.');
  await prisma.$transaction(async (tx) => {
    const changed = await tx.refundRequest.updateMany({ where, data: { reviewNote: note, ...(req.file ? { evidenceFile: req.file.filename } : {}) } });
    if (!changed.count) throw new HttpError(404, 'Refund request not found.');
    await logAudit(req.user, 'refund.review_details_saved', refund.id, req.file ? 'Document attached' : 'Note updated', tx);
  });
  res.json({ message: 'Refund details saved.' });
}

export async function downloadEvidence(req: Request, res: Response) {
  const { refund } = await editableRefund(req);
  if (!refund.evidenceFile) throw new HttpError(404, 'Document not found.');
  const filename = path.basename(refund.evidenceFile);
  res.setHeader('Cache-Control', 'private, no-store');
  res.download(path.join(env.mediaRoot, 'refunds', filename), filename);
}

export async function listRefunds(req: Request, res: Response): Promise<void> {
  const docIds = await managedDoctorIds(req.user!);
  const filters: Prisma.RefundRequestWhereInput[] = [];
  if (docIds !== null) {
    filters.push({ appointment: { slot: { doctorId: { in: docIds } } } });
    filters.push({ status: { in: ['approved', 'processing', 'completed'] } });
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
  const [field, direction] = sort.split('.');
  if (direction === 'asc' || direction === 'desc') {
    const columns: Record<string, Prisma.RefundRequestOrderByWithRelationInput> = {
      reference: { appointment: { reference: direction } }, patient: { appointment: { guestName: direction } },
      doctor: { appointment: { slot: { doctor: { user: { firstName: direction } } } } },
      amount: { amount: direction }, status: { status: direction }, date: { createdAt: direction },
    };
    if (Object.hasOwn(columns, field)) orderBy = [columns[field], { id: 'asc' }];
  }

  const page = Math.max(1, Number(req.query.page || 1) || 1);
  const limit = Math.min(100, Math.max(1, Math.trunc(Number(req.query.limit) || 25)));
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
    refunds: items.map((item) => ({ ...serializeRefundRequest(item), review_note: item.reviewNote,
      evidence_url: item.evidenceFile ? `/refunds/${item.id}/evidence` : null, evidence_name: item.evidenceFile,
    })),
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
  const reference = String(req.body?.transaction_reference || '').trim();
  if (!reference || reference.length > 90) throw new HttpError(400, 'Enter a valid refund transaction reference.');
  const updated = await finalizeCashRefund(id, req.user!, reference);
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
