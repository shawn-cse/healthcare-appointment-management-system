import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { User } from '@prisma/client';
import { prisma } from '../config/db.js';
import { env } from '../config/env.js';
import { HttpError } from './error.js';

export type UserRole = 'patient' | 'doctor' | 'receptionist' | 'admin';

export interface AuthTokenPayload {
  sub: string;
  role: string;
  version: number;
}

declare global {
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export function signToken(user: Pick<User, 'id' | 'role' | 'sessionVersion'>): string {
  return jwt.sign({ sub: String(user.id), role: user.role, version: user.sessionVersion }, env.jwtSecret, {
    expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

async function resolveUserFromToken(token: string): Promise<User | null> {
  try {
    const decoded = jwt.verify(token, env.jwtSecret) as AuthTokenPayload;
    const id = BigInt(decoded.sub);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user?.loginAllowed || (!user.isActive && user.role !== 'patient') || user.sessionVersion !== decoded.version) return null;
    return user;
  } catch {
    return null;
  }
}

function extractBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (auth && auth.startsWith('Bearer ')) {
    return auth.slice(7).trim();
  }
  return null;
}

export async function optionalAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = extractBearerToken(req);
  if (token) {
    const user = await resolveUserFromToken(token);
    if (user) req.user = user;
  }
  next();
}

export const authenticate = resolveSession(false);
export const authenticateSupport = resolveSession(true);

function resolveSession(allowInactive: boolean) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    const token = extractBearerToken(req);
    if (!token) {
      next(new HttpError(401, 'Authentication required.'));
      return;
    }
    const user = await resolveUserFromToken(token);
    if (!user) {
      next(new HttpError(401, 'Invalid or expired authentication session.'));
      return;
    }
    if (!user.isActive && !allowInactive) {
      next(new HttpError(403, 'This account has access to support and complaints only.'));
      return;
    }
    req.user = user;
    next();
  };
}

export function requireRoles(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new HttpError(401, 'Authentication required.'));
      return;
    }
    if (!roles.includes(req.user.role as UserRole)) {
      next(new HttpError(403, 'You do not have access to this section.'));
      return;
    }
    next();
  };
}
