import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/db.js';
import { signToken } from '../middleware/auth.js';
import { HttpError } from '../middleware/error.js';
import { logAudit } from '../services/audit.js';
import { serializeUser, userDisplayName } from '../services/serialize.js';
import { parseIsoDate } from '../utils/dateTime.js';
import { hashPassword, validatePasswordStrength, verifyPassword } from '../utils/password.js';
import { toRelativeMediaPath } from '../utils/upload.js';

const PHONE_REGEX = /^\+?[0-9]{10,15}$/;

async function getNextPatientUsername(): Promise<string> {
  const rows = await prisma.user.findMany({
    where: { username: { startsWith: 'patient', mode: 'insensitive' } },
    select: { username: true },
  });
  const usedNums = new Set<number>();
  for (const r of rows) {
    const m = /^patient(\d+)$/i.exec(r.username);
    if (m) usedNums.add(Number(m[1]));
  }
  let n = 1;
  for (;;) {
    if (!usedNums.has(n)) {
      const candidate = `patient${n}`;
      const conflict = await prisma.user.findFirst({
        where: {
          OR: [
            { username: { equals: candidate, mode: 'insensitive' } },
            { phone: candidate },
            { email: { equals: candidate, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      });
      if (!conflict) return candidate;
    }
    n++;
  }
}

const registerSchema = z.object({
  first_name: z.string().trim().min(1, 'First name is required.').max(150),
  last_name: z.string().trim().min(1, 'Last name is required.').max(150),
  username: z.string().trim().max(150).optional().default(''),
  phone: z
    .string()
    .trim()
    .regex(PHONE_REGEX, 'Enter a valid phone number (10–15 digits).'),
  dob: z.string().trim().min(1, 'Date of birth is required.'),
  email: z.string().trim().max(254).optional().default(''),
  nid: z.string().trim().max(30).optional().default(''),
  address: z.string().trim().optional().default(''),
  password1: z.string().optional(),
  password2: z.string().optional(),
  password: z.string().optional(),
});

export async function register(req: Request, res: Response): Promise<void> {
  const parsed = registerSchema.parse(req.body);
  const pw1 = parsed.password1 ?? parsed.password ?? '';
  const pw2 = parsed.password2 ?? pw1;

  if (pw1 !== pw2) {
    throw new HttpError(400, 'Passwords do not match.');
  }
  const pwErr = validatePasswordStrength(pw1);
  if (pwErr) throw new HttpError(400, pwErr);

  const dobDate = parseIsoDate(parsed.dob);
  if (!dobDate) throw new HttpError(400, 'Enter a valid date of birth (YYYY-MM-DD).');
  if (dobDate > new Date()) throw new HttpError(400, 'Date of birth cannot be in the future.');

  const cleanEmail = parsed.email.toLowerCase();
  if (cleanEmail) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
      throw new HttpError(400, 'Enter a valid email address.');
    }
    const emailConflict = await prisma.user.findFirst({
      where: { email: { equals: cleanEmail, mode: 'insensitive' } },
      select: { id: true },
    });
    if (emailConflict) throw new HttpError(400, 'An account with this email already exists.');
  }

  const phoneConflict = await prisma.user.findFirst({
    where: { phone: parsed.phone },
    select: { id: true },
  });
  if (phoneConflict) throw new HttpError(400, 'An account with this phone number already exists.');

  let finalUsername = parsed.username;
  if (finalUsername) {
    const conflict = await prisma.user.findFirst({
      where: {
        OR: [
          { username: { equals: finalUsername, mode: 'insensitive' } },
          { phone: finalUsername },
          { email: { equals: finalUsername, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    if (conflict) {
      throw new HttpError(400, 'An account with this username, phone or email already exists.');
    }
  } else {
    finalUsername = await getNextPatientUsername();
  }

  const passwordHash = await hashPassword(pw1);
  const user = await prisma.user.create({
    data: {
      username: finalUsername,
      email: cleanEmail,
      password: passwordHash,
      role: 'patient',
      firstName: parsed.first_name,
      lastName: parsed.last_name,
      phone: parsed.phone,
      dob: dobDate,
      nid: parsed.nid,
      address: parsed.address,
      isActive: true,
      isStaff: false,
      isSuperuser: false,
    },
  });

  await logAudit(user, 'patient.registered', Number(user.id));
  res.status(201).json({
    token: signToken(user),
    user: serializeUser(user),
    message: 'Your account has been created. Welcome to Green Hospital.',
  });
}

export async function login(req: Request, res: Response): Promise<void> {
  const identifier = String(req.body?.identifier || '').trim();
  const password = String(req.body?.password || '');
  const portal = req.body?.portal ? String(req.body.portal) : undefined;

  if (!identifier || !password) {
    throw new HttpError(400, 'Incorrect login details. Please verify your credentials and try again.');
  }

  const matches = await prisma.user.findMany({
    where: {
      OR: [
        { username: { equals: identifier, mode: 'insensitive' } },
        { phone: identifier },
        { email: { equals: identifier, mode: 'insensitive' } },
      ],
    },
    take: 2,
  });

  if (matches.length !== 1) {
    throw new HttpError(401, 'Incorrect login details. Please verify your credentials and try again.');
  }

  const user = matches[0];
  const valid = await verifyPassword(password, user.password);
  if (!valid || !user.isActive) {
    throw new HttpError(401, 'Incorrect login details. Please verify your credentials and try again.');
  }

  if (portal === 'patient' && user.role !== 'patient') {
    throw new HttpError(403, 'This is a staff account. Please sign in through the staff portal.');
  }
  if (portal === 'staff' && user.role === 'patient') {
    throw new HttpError(403, 'This is a patient account. Please sign in through the patient portal.');
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLogin: new Date() },
  });

  const doctorProfile =
    user.role === 'doctor'
      ? await prisma.doctorProfile.findUnique({ where: { userId: user.id }, select: { id: true } })
      : null;

  res.json({
    token: signToken(user),
    user: {
      ...serializeUser(user),
      doctor_profile_id: doctorProfile ? Number(doctorProfile.id) : null,
    },
    message: `Welcome back, ${user.firstName || user.username}.`,
  });
}

export async function me(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const doctorProfile =
    user.role === 'doctor'
      ? await prisma.doctorProfile.findUnique({
          where: { userId: user.id },
          include: { chamber: true, department: true },
        })
      : null;

  res.json({
    user: {
      ...serializeUser(user),
      doctor_profile_id: doctorProfile ? Number(doctorProfile.id) : null,
      doctor_profile: doctorProfile
        ? {
            id: Number(doctorProfile.id),
            designation: doctorProfile.designation,
            qualifications: doctorProfile.qualifications,
            room_number: doctorProfile.chamber?.roomNumber || doctorProfile.roomNumber || '',
            department_name: doctorProfile.department.name,
          }
        : null,
    },
  });
}

export async function checkUsername(req: Request, res: Response): Promise<void> {
  const username = String(req.query.username || '').trim();
  const excludeIdRaw = String(req.query.exclude_id || '').trim();

  if (!username) {
    res.json({
      valid: false,
      status: 'empty',
      message: 'Username must be unique.',
    });
    return;
  }

  const excludeId = /^\d+$/.test(excludeIdRaw) ? BigInt(excludeIdRaw) : undefined;
  const conflict = await prisma.user.findFirst({
    where: {
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
      OR: [
        { username: { equals: username, mode: 'insensitive' } },
        { phone: username },
        { email: { equals: username, mode: 'insensitive' } },
      ],
    },
    select: { id: true },
  });

  if (conflict) {
    res.json({
      valid: false,
      status: 'conflict',
      message: 'This username conflicts with another account identifier.',
    });
    return;
  }

  res.json({
    valid: true,
    status: 'available',
    message: 'Username is OK',
  });
}

export async function updateProfile(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const body = req.body as Record<string, string | undefined>;

  const firstName = (body.first_name ?? user.firstName).trim();
  const lastName = (body.last_name ?? user.lastName).trim();
  const username = (body.username ?? user.username).trim();
  const email = (body.email ?? user.email).trim().toLowerCase();
  const phone = (body.phone ?? user.phone ?? '').trim();
  const nid = (body.nid ?? user.nid).trim();
  const address = (body.address ?? user.address).trim();
  const dobRaw = body.dob !== undefined ? String(body.dob || '').trim() : undefined;

  if (!firstName) throw new HttpError(400, 'First name is required.');
  if (!username) throw new HttpError(400, 'Username cannot be empty.');
  if (!phone || !PHONE_REGEX.test(phone)) {
    throw new HttpError(400, 'Enter a valid phone number (10–15 digits).');
  }

  let dobDate = user.dob;
  if (dobRaw !== undefined) {
    if (!dobRaw) {
      if (user.role === 'patient') throw new HttpError(400, 'Date of birth is required.');
      dobDate = null;
    } else {
      const parsedDob = parseIsoDate(dobRaw);
      if (!parsedDob) throw new HttpError(400, 'Invalid date of birth (YYYY-MM-DD).');
      if (parsedDob > new Date()) throw new HttpError(400, 'Date of birth cannot be in the future.');
      dobDate = parsedDob;
    }
  } else if (user.role === 'patient' && !user.dob) {
    throw new HttpError(400, 'Date of birth is required.');
  }

  const usernameConflict = await prisma.user.findFirst({
    where: {
      NOT: { id: user.id },
      OR: [
        { username: { equals: username, mode: 'insensitive' } },
        { phone: username },
        { email: { equals: username, mode: 'insensitive' } },
      ],
    },
    select: { id: true },
  });
  if (usernameConflict) {
    throw new HttpError(400, 'This username conflicts with another account identifier.');
  }

  if (email) {
    const emailConflict = await prisma.user.findFirst({
      where: { NOT: { id: user.id }, email: { equals: email, mode: 'insensitive' } },
      select: { id: true },
    });
    if (emailConflict) throw new HttpError(400, 'An account with this email already exists.');
  }

  const phoneConflict = await prisma.user.findFirst({
    where: { NOT: { id: user.id }, phone },
    select: { id: true },
  });
  if (phoneConflict) throw new HttpError(400, 'An account with this phone already exists.');

  const avatarRel = req.file ? toRelativeMediaPath('profiles', req.file.filename) : undefined;

  const updated = await prisma.$transaction(async (tx) => {
    const u = await tx.user.update({
      where: { id: user.id },
      data: {
        firstName,
        lastName,
        username,
        email,
        phone,
        dob: dobDate,
        nid,
        address,
        ...(avatarRel ? { avatar: avatarRel } : {}),
      },
    });

    if (u.role === 'doctor') {
      const doc = await tx.doctorProfile.findUnique({ where: { userId: u.id } });
      if (doc) {
        const docUpdate: Record<string, unknown> = {};
        if (body.designation !== undefined) docUpdate.designation = body.designation.trim();
        if (body.qualifications !== undefined) docUpdate.qualifications = body.qualifications;
        if (body.room_number !== undefined) {
          const rVal = body.room_number.trim();
          docUpdate.roomNumber = rVal;
          if (!rVal) {
            docUpdate.chamberId = null;
          } else {
            const ch = await tx.chamber.findFirst({
              where: { roomNumber: { equals: rVal, mode: 'insensitive' } },
            });
            if (ch) {
              docUpdate.chamberId = ch.id;
              docUpdate.roomNumber = ch.roomNumber;
              docUpdate.chamberAddress = ch.address;
              docUpdate.contactNumber = ch.contactNumber;
            }
          }
        }
        if (Object.keys(docUpdate).length) {
          await tx.doctorProfile.update({ where: { id: doc.id }, data: docUpdate });
        }
      }
    }

    await logAudit(u, 'profile.updated', Number(u.id), '', tx);
    return u;
  });

  const doctorProfile =
    updated.role === 'doctor'
      ? await prisma.doctorProfile.findUnique({
          where: { userId: updated.id },
          include: { chamber: true, department: true },
        })
      : null;

  res.json({
    user: {
      ...serializeUser(updated),
      doctor_profile_id: doctorProfile ? Number(doctorProfile.id) : null,
      doctor_profile: doctorProfile
        ? {
            id: Number(doctorProfile.id),
            designation: doctorProfile.designation,
            qualifications: doctorProfile.qualifications,
            room_number: doctorProfile.chamber?.roomNumber || doctorProfile.roomNumber || '',
            department_name: doctorProfile.department.name,
          }
        : null,
    },
    message: 'Profile updated successfully.',
  });
}

export async function changePassword(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const currentPassword = String(req.body?.current_password || '');
  const newPassword = String(req.body?.new_password || '');
  const confirmPassword = String(req.body?.confirm_password ?? newPassword);

  if (!(await verifyPassword(currentPassword, user.password))) {
    throw new HttpError(400, 'Your old password was entered incorrectly. Please enter it again.');
  }
  if (newPassword !== confirmPassword) {
    throw new HttpError(400, 'The two password fields didn’t match.');
  }
  const err = validatePasswordStrength(newPassword);
  if (err) throw new HttpError(400, err);

  const hash = await hashPassword(newPassword);
  await prisma.user.update({
    where: { id: user.id },
    data: { password: hash },
  });

  res.json({ message: 'Your password has been updated.', name: userDisplayName(user) });
}
