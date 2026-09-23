import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { me, requireAuth, signToken } from '../lib/auth';
import { HttpError, badRequest, unauthorized } from '../lib/errors';
import { parse } from '../lib/validate';
import { lockedFor, recordFailure, recordSuccess } from '../lib/loginGuard';

// So sánh với hash giả khi không có tài khoản → thời gian phản hồi như nhau, không dò được tên đăng nhập
const DUMMY_HASH = bcrypt.hashSync('workping-dummy-password', 10);

export const authRouter = Router();

/** Mật khẩu: tối thiểu 8 ký tự, có cả chữ và số */
export const passwordRule = z
  .string()
  .min(8, 'tối thiểu 8 ký tự')
  .max(200)
  .regex(/[A-Za-z]/, 'phải có chữ cái')
  .regex(/\d/, 'phải có chữ số');

/** Mật khẩu tạm ngẫu nhiên khi tạo / đặt lại (không dùng mật khẩu mặc định chung) */
export function tempPassword(): string {
  const chars = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 10; i++) s += chars[crypto.randomInt(chars.length)];
  return /\d/.test(s) && /[A-Za-z]/.test(s) ? s : tempPassword();
}

export const profileSelect = {
  id: true,
  code: true,
  fullName: true,
  title: true,
  role: true,
  team: true,
  phone: true,
  email: true,
  username: true,
  status: true,
  mustChangePassword: true,
  managerId: true,
  manager: { select: { id: true, fullName: true } },
} as const;

authRouter.post('/login', async (req, res) => {
  const body = parse(z.object({ username: z.string().min(1).max(100), password: z.string().min(1).max(200) }), req.body);
  const username = body.username.trim().toLowerCase();
  const ip = req.ip ?? '';
  const wait = lockedFor(ip, username);
  if (wait) throw new HttpError(429, `Đăng nhập sai quá nhiều lần. Thử lại sau ${Math.ceil(wait / 60)} phút`);
  const user = await prisma.user.findUnique({ where: { username } });
  const ok = await bcrypt.compare(body.password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || user.status !== 'ACTIVE' || !ok) {
    recordFailure(ip, username);
    console.warn(`[auth] đăng nhập sai: ${username} từ ${ip}`);
    throw unauthorized('Sai tên đăng nhập hoặc mật khẩu');
  }
  recordSuccess(ip, username);
  const profile = await prisma.user.findUnique({ where: { id: user.id }, select: profileSelect });
  res.json({ token: signToken(user.id, user.tokenVersion), user: profile });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  res.json(await prisma.user.findUnique({ where: { id: me(req).id }, select: profileSelect }));
});

authRouter.post('/change-password', requireAuth, async (req, res) => {
  const body = parse(
    z.object({ oldPassword: z.string().max(200), newPassword: passwordRule }),
    req.body,
  );
  const user = await prisma.user.findUniqueOrThrow({ where: { id: me(req).id } });
  if (!(await bcrypt.compare(body.oldPassword, user.passwordHash))) throw badRequest('Mật khẩu cũ không đúng');
  if (body.newPassword === body.oldPassword) throw badRequest('Mật khẩu mới phải khác mật khẩu cũ');
  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(body.newPassword, 10), mustChangePassword: false, tokenVersion: { increment: 1 } },
  });
  // Các thiết bị khác phải đăng nhập lại; thiết bị hiện tại nhận token mới
  res.json({ ok: true, token: signToken(updated.id, updated.tokenVersion) });
});
