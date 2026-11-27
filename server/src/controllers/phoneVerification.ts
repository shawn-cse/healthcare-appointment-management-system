import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { HttpError } from '../middleware/error.js';
import { logAudit } from '../services/audit.js';
import { userDisplayName } from '../services/serialize.js';
import { normalizePhone, PHONE_REGEX } from '../utils/phone.js';

function hash(userId: bigint, phone: string, code: string) {
  return createHmac('sha256', env.jwtSecret).update(`${userId}:${phone}:${code}`).digest('hex');
}

function comparableName(name: string) {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
}

function ageOn(dob: Date, date: Date) {
  const birthday = dob.toISOString().slice(5, 10);
  return date.getUTCFullYear() - dob.getUTCFullYear() - Number(date.toISOString().slice(5, 10) < birthday);
}

export async function sendPhoneCode(req: Request, res: Response) {
  const user = req.user!;
  const phone = user.phone || '';
  if (!PHONE_REGEX.test(phone)) throw new HttpError(400, 'Add a valid patient phone number first.');
  if (user.phoneVerifiedAt) return res.json({ message: 'Your phone is already verified.' });
  const endpoint = process.env.PHONE_SMS_WEBHOOK;
  const secret = process.env.PHONE_SMS_TOKEN;
  if (!endpoint || !secret || !endpoint.startsWith('https://')) throw new HttpError(503, 'Phone verification is currently unavailable.');
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  const now = new Date();
  const sent = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM hospital_user WHERE id = ${user.id} FOR UPDATE`;
    const prior = await tx.phoneChallenge.findUnique({ where: { userId: user.id } });
    if (prior && +now - +prior.sentAt < 60_000) throw new HttpError(429, 'Please wait a minute before requesting another code.');
    const data = { phone, codeHash: hash(user.id, phone, code), sentAt: now, expiresAt: new Date(+now + 600_000), attempts: 0 };
    return tx.phoneChallenge.upsert({ where: { userId: user.id }, create: { userId: user.id, ...data }, update: data });
  });
  try {
    const response = await fetch(endpoint, { method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' },
      body: JSON.stringify({ to: /^01\d{9}$/.test(phone) ? `+88${phone}` : `+${phone}`, message: `Your Green Hospital verification code is ${code}. It expires in 10 minutes.` }),
      redirect: 'error', signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw new Error('SMS adapter rejected the request');
  } catch {
    await prisma.phoneChallenge.deleteMany({ where: { userId: user.id, codeHash: sent.codeHash } });
    throw new HttpError(503, 'The verification message could not be sent.');
  }
  return res.json({ message: 'Verification code sent.' });
}

export async function verifyPhoneCode(req: Request, res: Response) {
  const user = req.user!;
  const code = String(req.body?.code || '');
  if (!/^\d{6}$/.test(code)) throw new HttpError(400, 'Enter the six-digit verification code.');
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM hospital_user WHERE id = ${user.id} FOR UPDATE`;
    const account = await tx.user.findUniqueOrThrow({ where: { id: user.id } });
    const challenge = await tx.phoneChallenge.findUnique({ where: { userId: user.id } });
    if (!challenge || challenge.expiresAt <= new Date() || challenge.attempts >= 5 || account.phone !== challenge.phone) return null;
    const expected = Buffer.from(hash(user.id, challenge.phone, code), 'hex');
    if (!timingSafeEqual(expected, Buffer.from(challenge.codeHash, 'hex'))) {
      await tx.phoneChallenge.update({ where: { userId: user.id }, data: { attempts: { increment: 1 } } });
      return null;
    }
    await tx.phoneChallenge.delete({ where: { userId: user.id } });
    await tx.user.update({ where: { id: user.id }, data: { phoneVerifiedAt: new Date() } });
    const cutoff = new Date(Date.now() - 365 * 86400_000);
    const equivalentPhones = [challenge.phone, `+${challenge.phone}`, ...(/^01\d{9}$/.test(challenge.phone) ? [`88${challenge.phone}`, `+88${challenge.phone}`] : [])];
    const candidates = await tx.appointment.findMany({ where: { patientId: null, guestPhone: { in: equivalentPhones }, source: { in: ['desk', 'phone'] }, createdAt: { gte: cutoff } } });
    const name = comparableName(userDisplayName(account));
    const eligible = candidates.filter((item) => normalizePhone(item.guestPhone) === challenge.phone && comparableName(item.guestName) === name && account.dob && (
      item.guestDob ? +item.guestDob === +account.dob : item.guestGender && item.guestGender === account.gender && item.guestAge === ageOn(account.dob, item.createdAt)
    ));
    const linked = await tx.appointment.updateMany({ where: { id: { in: eligible.map((item) => item.id) }, patientId: null }, data: { patientId: user.id } });
    await logAudit(user, 'account.phone_verified', Number(user.id), `${linked.count} historical bookings matched`, tx);
    return linked.count;
  });
  if (result === null) throw new HttpError(400, 'The code is invalid or has expired.');
  return res.json({ message: 'Phone verified.', linked: result });
}
