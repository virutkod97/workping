import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { me } from '../lib/auth';
import { idParam, parse } from '../lib/validate';
import { getVapid, sendPushToUser } from '../services/push';

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

export const pushRouter = Router();

/** Khoá công khai VAPID để trình duyệt tạo đăng ký nhận push */
pushRouter.get('/public-key', async (_req, res) => {
  res.json({ publicKey: (await getVapid()).publicKey });
});

const subscriptionBody = z.object({
  subscription: z.object({
    endpoint: z.string().url(),
    keys: z.object({ p256dh: z.string().min(10), auth: z.string().min(4) }),
  }),
  userAgent: z.string().max(500).optional(),
});

/** Trình duyệt/thiết bị bật thông báo (gọi lại mỗi lần mở app để cập nhật) */
pushRouter.post('/subscribe', async (req, res) => {
  const { subscription: s, userAgent } = parse(subscriptionBody, req.body);
  const userId = me(req).id;
  // Cùng 1 thiết bị đăng nhập tài khoản khác → chuyển đăng ký sang tài khoản mới
  await prisma.webPushSubscription.upsert({
    where: { endpoint: s.endpoint },
    create: { endpoint: s.endpoint, p256dh: s.keys.p256dh, auth: s.keys.auth, userAgent, userId },
    update: { p256dh: s.keys.p256dh, auth: s.keys.auth, userAgent, userId },
  });
  res.json({ ok: true });
});

/** Gọi khi đăng xuất hoặc tắt thông báo trên thiết bị */
pushRouter.post('/unsubscribe', async (req, res) => {
  const body = parse(z.object({ endpoint: z.string().url() }), req.body);
  await prisma.webPushSubscription.deleteMany({ where: { endpoint: body.endpoint, userId: me(req).id } });
  res.json({ ok: true });
});

/** Gửi thử tới mọi thiết bị của chính mình */
pushRouter.post('/test', async (req, res) => {
  const userId = me(req).id;
  const devices = await prisma.webPushSubscription.count({ where: { userId } });
  const sent = await sendPushToUser(userId, { title: 'WorkPing', body: 'Thông báo thử nghiệm thành công 🎉', url: '/notifications', tag: 'test' });
  res.json({ devices, sent });
});
