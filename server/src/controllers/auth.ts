import crypto from 'node:crypto';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../config/db.js';
import { signToken } from '../middleware/auth.js';
import { HttpError } from '../middleware/error.js';
import { logAudit } from '../services/audit.js';
import { serializeUser, userDisplayName } from '../services/serialize.js';
import { parseIsoDate } from '../utils/dateTime.js';
import { hashPassword, validatePasswordStrength, verifyPassword } from '../utils/password.js';
import { toRelativeMediaPath } from '../utils/upload.js';
import { normalizePhone, PHONE_REGEX } from '../utils/phone.js';

const profileInclude = { chamber: true, department: true, receptionists: { include: { user: true } } } as const;

function serializeAccountDoctor(profile: Prisma.DoctorProfileGetPayload<{ include: typeof profileInclude }> | null) {
  if (!profile) return null;
  const receptionist = profile.receptionists.find((assignment) => assignment.user.isActive)?.user;
  return {
    id: Number(profile.id),
    designation: profile.designation,
    qualifications: profile.qualifications,
    professional_experience: profile.professionalExperience,
    registration_number: profile.registrationNumber,
    receptionist_name: receptionist ? userDisplayName(receptionist) : '',
    room_number: profile.chamber?.roomNumber || profile.roomNumber || '',
    department_name: profile.department?.name || '',
  };
}

const registerSchema = z.object({
  full_name: z.string().trim().min(1, 'Full name is required.').max(150),
  username: z.string().trim().max(150).optional().default(''),
  phone: z
    .string()
    .transform(normalizePhone)
    .pipe(z.string().regex(PHONE_REGEX, 'Enter a valid phone number (10–15 digits).')),
  gender: z.enum(['female', 'male', 'other']),
  dob: z.string().trim().min(1, 'Date of birth is required.'),
  email: z.string().trim().max(254).optional().default(''),
  nid: z.string().trim().max(30).optional().default(''),
  address: z.string().trim().optional().default(''),
  password1: z.string().optional(),
  password2: z.string().min(1, 'Confirm your password.'),
  password: z.string().optional(),
});

export async function register(req: Request, res: Response): Promise<void> {
  const parsed = registerSchema.parse(req.body);
  const pw1 = parsed.password1 ?? parsed.password ?? '';
  const pw2 = parsed.password2;

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
    where: { role: 'patient', phone: parsed.phone },
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
    const slug = parsed.full_name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '')
      .slice(0, 12) || 'patient';
    for (;;) {
      const candidate = `${slug}_${crypto.randomBytes(3).toString('hex')}`;
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
      if (!conflict) {
        finalUsername = candidate;
        break;
      }
    }
  }

  const passwordHash = await hashPassword(pw1);
  const user = await prisma.user.create({
    data: {
      username: finalUsername,
      email: cleanEmail,
      password: passwordHash,
      role: 'patient',
      firstName: parsed.full_name,
      gender: parsed.gender,
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

  const rawMatches = await prisma.user.findMany({
    where: {
      OR: [
        { username: { equals: identifier, mode: 'insensitive' } },
        { phone: normalizePhone(identifier) },
        { email: { equals: identifier, mode: 'insensitive' } },
      ],
    },
    include: { chamber: true },
    take: 5,
  });

  // If multiple accounts share a clinic phone, scope to selected login portal cleanly
  const matches =
    rawMatches.length > 1 && portal
      ? rawMatches.filter((u) => (portal === 'patient' ? u.role === 'patient' : u.role !== 'patient'))
      : rawMatches;

  if (matches.length !== 1) {
    throw new HttpError(401, 'Incorrect login details. Please verify your credentials and try again.');
  }

  const user = matches[0];
  const valid = await verifyPassword(password, user.password);
  if (!valid || !user.loginAllowed || (!user.isActive && user.role !== 'patient')) {
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
  const userWithRoom = await prisma.user.findUnique({
    where: { id: req.user!.id },
    include: { chamber: true },
  });
  const user = userWithRoom || req.user!;
  const doctorProfile =
    user.role === 'doctor'
      ? await prisma.doctorProfile.findUnique({
          where: { userId: user.id },
          include: profileInclude,
        })
      : null;

  res.json({
    user: {
      ...serializeUser(user),
      doctor_profile_id: doctorProfile ? Number(doctorProfile.id) : null,
      doctor_profile: serializeAccountDoctor(doctorProfile),
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

export async function checkEmail(req: Request, res: Response): Promise<void> {
  const email = String(req.query.email || '').trim().toLowerCase();
  const excludeIdRaw = String(req.query.exclude_id || '').trim();
  if (!email) {
    res.json({ valid: false, status: 'empty', message: 'Email address is required.' });
    return;
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    res.json({ valid: false, status: 'invalid', message: 'Enter a valid email format.' });
    return;
  }
  const excludeId = /^\d+$/.test(excludeIdRaw) ? BigInt(excludeIdRaw) : undefined;
  const conflict = await prisma.user.findFirst({
    where: {
      ...(excludeId ? { NOT: { id: excludeId } } : {}),
      OR: [
        { email: { equals: email, mode: 'insensitive' } },
        { username: { equals: email, mode: 'insensitive' } },
      ],
    },
    select: { id: true },
  });
  if (conflict) {
    res.json({
      valid: false,
      status: 'conflict',
      message: 'This email address is already used by another account.',
    });
    return;
  }
  res.json({ valid: true, status: 'available', message: 'Email is OK' });
}

export async function checkPhone(req: Request, res: Response): Promise<void> {
  const phone = normalizePhone(String(req.query.phone || ''));
  const role = String(req.query.role || 'patient').trim().toLowerCase();
  const excludeIdRaw = String(req.query.exclude_id || '').trim();
  if (!phone) {
    res.json({
      valid: role !== 'patient',
      status: 'empty',
      message: role === 'patient' ? 'Phone number is required for patients.' : 'Optional for staff',
    });
    return;
  }
  if (!PHONE_REGEX.test(phone)) {
    res.json({ valid: false, status: 'invalid', message: 'Enter a valid 10–15 digit phone number.' });
    return;
  }
  if (role === 'patient') {
    const excludeId = /^\d+$/.test(excludeIdRaw) ? BigInt(excludeIdRaw) : undefined;
    const conflict = await prisma.user.findFirst({
      where: {
        role: 'patient',
        phone,
        ...(excludeId ? { NOT: { id: excludeId } } : {}),
      },
      select: { id: true },
    });
    if (conflict) {
      res.json({
        valid: false,
        status: 'conflict',
        message: 'A patient account with this phone already exists.',
      });
      return;
    }
  }
  res.json({ valid: true, status: 'available', message: 'Phone is OK' });
}

export async function updateProfile(req: Request, res: Response): Promise<void> {
  const user = req.user!;
  const body = req.body as Record<string, string | undefined>;

  const firstName = (body.full_name ?? body.first_name ?? user.firstName).trim();
  const lastName = body.full_name !== undefined ? '' : (body.last_name ?? user.lastName).trim();
  const username = (body.username ?? user.username).trim();
  const email = (body.email ?? user.email).trim().toLowerCase();
  const phoneRaw = normalizePhone(body.phone ?? user.phone ?? '');
  const nid = (body.nid ?? user.nid).trim();
  const address = (body.address ?? user.address).trim();
  const dobRaw = body.dob !== undefined ? String(body.dob || '').trim() : undefined;
  const gender = body.gender || user.gender;
  if (gender && !['female', 'male', 'other'].includes(gender)) throw new HttpError(400, 'Select a valid gender.');

  if (!firstName || firstName.length > 150 || lastName.length > 150) throw new HttpError(400, 'Enter a name up to 150 characters.');
  if (!username) throw new HttpError(400, 'Username cannot be empty.');
  if (user.role === 'patient') {
    if (!phoneRaw || !PHONE_REGEX.test(phoneRaw)) {
      throw new HttpError(400, 'Enter a valid phone number (10–15 digits).');
    }
  } else {
    if (!email) throw new HttpError(400, 'Email address is required for staff accounts.');
    if (phoneRaw && !PHONE_REGEX.test(phoneRaw)) {
      throw new HttpError(400, 'Enter a valid phone number (10–15 digits).');
    }
  }
  const phone: string | null = phoneRaw || null;

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

  if (user.role === 'patient' && phone) {
    const phoneConflict = await prisma.user.findFirst({
      where: { NOT: { id: user.id }, role: 'patient', phone },
      select: { id: true },
    });
    if (phoneConflict) throw new HttpError(400, 'A patient account with this phone already exists.');
  }

  const avatarRel = req.file ? toRelativeMediaPath('profiles', req.file.filename) : undefined;

  const updated = await prisma.$transaction(async (tx) => {
    let syncedChamberId: bigint | null | undefined = undefined;
    if (user.role === 'admin' && body.room_number !== undefined) {
      const rVal = body.room_number.trim();
      if (!rVal) {
        syncedChamberId = null;
      } else {
        const ch = await tx.chamber.findFirst({
          where: { roomNumber: { equals: rVal, mode: 'insensitive' } },
        });
        syncedChamberId = ch ? ch.id : null;
      }
    }

    const u = await tx.user.update({
      where: { id: user.id },
      data: {
        firstName,
        lastName,
        username,
        email,
        phone,
        ...(phone !== user.phone ? { phoneVerifiedAt: null } : {}),
        dob: dobDate,
        gender,
        nid,
        address,
        ...(syncedChamberId !== undefined ? { chamberId: syncedChamberId } : {}),
        ...(avatarRel ? { avatar: avatarRel } : {}),
      },
      include: { chamber: true },
    });

    if (u.role === 'doctor') {
      const doc = await tx.doctorProfile.findUnique({ where: { userId: u.id } });
      if (doc) {
        const docUpdate: Record<string, unknown> = {};
        if (body.designation !== undefined) docUpdate.designation = body.designation.trim();
        if (body.registration_number !== undefined) {
          const registration = body.registration_number.trim();
          if (!registration || registration.length > 100) throw new HttpError(400, 'Enter a valid BMDC registration number.');
          docUpdate.registrationNumber = registration;
        }
        if (body.qualifications !== undefined) docUpdate.qualifications = body.qualifications;
        if (body.professional_experience !== undefined) docUpdate.professionalExperience = body.professional_experience;
        if (gender) docUpdate.gender = gender;
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
          include: profileInclude,
        })
      : null;

  res.json({
    user: {
      ...serializeUser(updated),
      doctor_profile_id: doctorProfile ? Number(doctorProfile.id) : null,
      doctor_profile: serializeAccountDoctor(doctorProfile),
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
  const changed = await prisma.user.updateMany({
    where: { id: user.id, sessionVersion: user.sessionVersion },
    data: { password: hash, sessionVersion: { increment: 1 } },
  });
  if (!changed.count) throw new HttpError(409, 'The account changed. Sign in again to update your password.');

  res.json({ message: 'Your password has been updated.', name: userDisplayName(user) });
}
