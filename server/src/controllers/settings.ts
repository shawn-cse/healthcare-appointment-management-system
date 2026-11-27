import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/db.js';
import { logAudit } from '../services/audit.js';

const settings = z.object({
  defaultNoticeHours: z.number().int().min(0).max(4320),
  defaultAdvanceDays: z.number().int().min(1).max(180),
  defaultPaymentHours: z.number().int().min(1).max(4320),
  defaultCancelMode: z.enum(['percent', 'fixed']),
  defaultCancelValue: z.number().min(0).max(9_999_999.99),
  defaultHospitalMode: z.enum(['percent', 'fixed']),
  defaultHospitalValue: z.number().min(0).max(500),
}).refine((value) => (value.defaultCancelMode !== 'percent' || value.defaultCancelValue <= 100) && (value.defaultHospitalMode !== 'percent' || value.defaultHospitalValue <= 100), 'Percentages cannot exceed 100.');

export async function getSettings(_req: Request, res: Response) {
  const current = await prisma.hospitalPolicy.upsert({ where: { id: 1 }, update: {}, create: { id: 1 } });
  res.json({ settings: { ...current, defaultCancelValue: Number(current.defaultCancelValue), defaultHospitalValue: Number(current.defaultHospitalValue) } });
}

export async function updateSettings(req: Request, res: Response) {
  const data = settings.parse(req.body);
  await prisma.$transaction(async (tx) => {
    const previous = await tx.hospitalPolicy.findUnique({ where: { id: 1 } });
    await tx.hospitalPolicy.upsert({ where: { id: 1 }, create: { id: 1, ...data }, update: data });
    await logAudit(req.user, 'system.settings_updated', 'hospital policy', JSON.stringify({ previous, updated: data }), tx);
  });
  res.json({ message: 'System settings saved.' });
}
