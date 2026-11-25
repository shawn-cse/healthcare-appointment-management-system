import type { Prisma, PrismaClient, User } from '@prisma/client';
import { prisma } from '../config/db.js';

type DbClient = PrismaClient | Prisma.TransactionClient;

export async function doctorAllowed(
  user: Pick<User, 'id' | 'role'> | undefined | null,
  doctorIdOrObj: bigint | { id: bigint; userId: bigint },
  db: DbClient = prisma
): Promise<boolean> {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (typeof doctorIdOrObj === 'bigint') {
    if (user.role === 'doctor') {
      const doc = await db.doctorProfile.findUnique({
        where: { id: doctorIdOrObj },
        select: { userId: true },
      });
      return doc?.userId === user.id;
    }
    if (user.role === 'receptionist') {
      const link = await db.doctorReceptionist.findUnique({
        where: {
          doctorProfileId_userId: { doctorProfileId: doctorIdOrObj, userId: user.id },
        },
      });
      return Boolean(link);
    }
    return false;
  }

  if (user.role === 'doctor') {
    return doctorIdOrObj.userId === user.id;
  }
  if (user.role === 'receptionist') {
    const link = await db.doctorReceptionist.findUnique({
      where: {
        doctorProfileId_userId: { doctorProfileId: doctorIdOrObj.id, userId: user.id },
      },
    });
    return Boolean(link);
  }
  return false;
}

export async function managedDoctorIds(
  user: Pick<User, 'id' | 'role'>,
  db: DbClient = prisma
): Promise<bigint[] | null> {
  if (user.role === 'admin') return null; // null means all doctors
  if (user.role === 'doctor') {
    const docs = await db.doctorProfile.findMany({
      where: { userId: user.id },
      select: { id: true },
    });
    return docs.map((d) => d.id);
  }
  if (user.role === 'receptionist') {
    const links = await db.doctorReceptionist.findMany({
      where: { userId: user.id },
      select: { doctorProfileId: true },
    });
    return links.map((l) => l.doctorProfileId);
  }
  return [];
}

export function appointmentScopeWhere(
  user: Pick<User, 'id' | 'role'>,
  docIds: bigint[] | null
): Prisma.AppointmentWhereInput {
  if (user.role === 'patient') {
    return { patientId: user.id };
  }
  if (user.role === 'admin') {
    return {};
  }
  return {
    slot: {
      doctorId: { in: docIds ?? [] },
    },
  };
}

export async function appointmentAllowed(
  user: Pick<User, 'id' | 'role'>,
  appt: { patientId: bigint | null; slot: { doctorId: bigint; doctor?: { id: bigint; userId: bigint } } },
  db: DbClient = prisma
): Promise<boolean> {
  if (user.role === 'patient') {
    return appt.patientId === user.id;
  }
  if (user.role === 'admin') return true;
  return doctorAllowed(user, appt.slot.doctor ?? appt.slot.doctorId, db);
}
