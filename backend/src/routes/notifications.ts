import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { me } from '../lib/auth';
import { idParam, parse } from '../lib/validate';

export const notificationsRouter = Router();

notificationsRouter.get('/', async (req, res) => {
  const q = parse(
    z.object({ unread: z.enum(['0', '1']).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), before: z.coerce.number().int().optional() }),
    req.query,
  );
  const items = await prisma.notification.findMany({
    where: { userId: me(req).id, ...(q.unread === '1' ? { readAt: null } : {}), ...(q.before ? { id: { lt: q.before } } : {}) },
    orderBy: { id: 'desc' },
    take: q.limit,
  });
  res.json(items);
});

notificationsRouter.get('/unread-count', async (req, res) => {
  res.json({ count: await prisma.notification.count({ where: { userId: me(req).id, readAt: null } }) });
});

notificationsRouter.post('/read-all', async (req, res) => {
  await prisma.notification.updateMany({ where: { userId: me(req).id, readAt: null }, data: { readAt: new Date() } });
  res.json({ ok: true });
});

notificationsRouter.post('/:id/read', async (req, res) => {
  const id = parse(idParam, req.params.id);
  await prisma.notification.updateMany({ where: { id, userId: me(req).id, readAt: null }, data: { readAt: new Date() } });
  res.json({ ok: true });
});

export const devicesRouter = Router();

/** App mobile đăng ký FCM token sau khi đăng nhập / khi token đổi */
devicesRouter.post('/', async (req, res) => {
  const body = parse(z.object({ token: z.string().min(10), platform: z.enum(['android', 'ios', 'web']) }), req.body);
  const userId = me(req).id;
  await prisma.deviceToken.upsert({
    where: { token: body.token },
    create: { token: body.token, platform: body.platform, userId },
    update: { platform: body.platform, userId },
  });
  res.json({ ok: true });
});

/** Gọi khi đăng xuất để thiết bị không nhận thông báo của tài khoản cũ */
devicesRouter.delete('/', async (req, res) => {
  const body = parse(z.object({ token: z.string().min(10) }), req.body);
  await prisma.deviceToken.deleteMany({ where: { token: body.token, userId: me(req).id } });
  res.json({ ok: true });
});
