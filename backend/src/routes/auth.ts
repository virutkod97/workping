import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { me, requireAuth, signToken } from '../lib/auth';
import { badRequest, unauthorized } from '../lib/errors';
import { parse } from '../lib/validate';

export const authRouter = Router();

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
  const body = parse(z.object({ username: z.string().min(1), password: z.string().min(1) }), req.body);
  const user = await prisma.user.findUnique({ where: { username: body.username.trim().toLowerCase() } });
  if (!user || user.status !== 'ACTIVE' || !(await bcrypt.compare(body.password, user.passwordHash))) {
    throw unauthorized('Sai tên đăng nhập hoặc mật khẩu');
  }
  const profile = await prisma.user.findUnique({ where: { id: user.id }, select: profileSelect });
  res.json({ token: signToken(user.id), user: profile });
});

authRouter.get('/me', requireAuth, async (req, res) => {
  res.json(await prisma.user.findUnique({ where: { id: me(req).id }, select: profileSelect }));
});

authRouter.post('/change-password', requireAuth, async (req, res) => {
  const body = parse(
    z.object({ oldPassword: z.string(), newPassword: z.string().min(6, 'tối thiểu 6 ký tự') }),
    req.body,
  );
  const user = await prisma.user.findUniqueOrThrow({ where: { id: me(req).id } });
  if (!(await bcrypt.compare(body.oldPassword, user.passwordHash))) throw badRequest('Mật khẩu cũ không đúng');
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(body.newPassword, 10), mustChangePassword: false },
  });
  res.json({ ok: true });
});
