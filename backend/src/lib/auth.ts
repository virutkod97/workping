import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role, User } from '@prisma/client';
import { config } from '../config';
import { prisma } from './prisma';
import { forbidden, unauthorized } from './errors';

export type AuthUser = Pick<User, 'id' | 'role' | 'fullName' | 'managerId' | 'status'>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(userId: number): string {
  return jwt.sign({ sub: String(userId) }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) throw unauthorized();
  let sub: string;
  try {
    sub = String((jwt.verify(h.slice(7), config.jwtSecret) as jwt.JwtPayload).sub);
  } catch {
    throw unauthorized('Phiên đăng nhập hết hạn');
  }
  const user = await prisma.user.findUnique({
    where: { id: Number(sub) },
    select: { id: true, role: true, fullName: true, managerId: true, status: true },
  });
  if (!user || user.status !== 'ACTIVE') throw unauthorized('Tài khoản không còn hoạt động');
  req.user = user;
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) throw forbidden();
    next();
  };
}

export function me(req: Request): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}
