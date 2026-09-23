import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import type { Role, User } from '@prisma/client';
import { config } from '../config';
import { prisma } from './prisma';
import { forbidden, unauthorized } from './errors';

export type AuthUser = Pick<User, 'id' | 'role' | 'fullName' | 'managerId' | 'status' | 'mustChangePassword'>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(userId: number, tokenVersion = 0): string {
  return jwt.sign({ sub: String(userId), v: tokenVersion }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as jwt.SignOptions['expiresIn'],
  });
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) throw unauthorized();
  let payload: jwt.JwtPayload;
  try {
    payload = jwt.verify(h.slice(7), config.jwtSecret, { algorithms: ['HS256'] }) as jwt.JwtPayload;
  } catch {
    throw unauthorized('Phiên đăng nhập hết hạn');
  }
  const user = await prisma.user.findUnique({
    where: { id: Number(payload.sub) },
    select: { id: true, role: true, fullName: true, managerId: true, status: true, mustChangePassword: true, tokenVersion: true },
  });
  if (!user || user.status !== 'ACTIVE') throw unauthorized('Tài khoản không còn hoạt động');
  // Mật khẩu đã đổi / bị đặt lại sau khi cấp token → buộc đăng nhập lại
  if ((payload.v ?? 0) !== user.tokenVersion) throw unauthorized('Phiên đăng nhập đã hết hiệu lực, vui lòng đăng nhập lại');
  const { tokenVersion: _v, ...rest } = user;
  req.user = rest;
  next();
}

/** Tài khoản đang dùng mật khẩu tạm: chỉ được xem hồ sơ & đổi mật khẩu */
export function requirePasswordChanged(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.mustChangePassword) throw forbidden('Bạn cần đổi mật khẩu trước khi sử dụng');
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
