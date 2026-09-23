import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { me } from '../lib/auth';
import { config } from '../config';
import { idParam, parse } from '../lib/validate';
import { checkPushConnectivity, deviceLabel, getVapid, isAllowedPushEndpoint, sendPushDetailed } from '../services/push';
import { requirePasswordChanged, requireRole } from '../lib/auth';
import { notFound } from '../lib/errors';

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
    endpoint: z.string().url().max(1000).refine(isAllowedPushEndpoint, 'không phải địa chỉ dịch vụ thông báo đẩy hợp lệ'),
    keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(4).max(100) }),
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
  const results = await sendPushDetailed(userId, { title: 'WorkPing', body: 'Thông báo thử nghiệm thành công 🎉', url: '/notifications', tag: 'test' });
  res.json({ devices: results.length, sent: results.filter((r) => r.ok).length, results });
});

// ───────── Quản trị: chẩn đoán thông báo đẩy ─────────
// /push nằm trước bước chặn mật khẩu tạm (để điện thoại đăng ký được) → các API quản trị phải tự chặn
const adminOnly = [requirePasswordChanged, requireRole('ADMIN', 'HEAD')];

/** Mọi nhân sự đang hoạt động + các thiết bị đã bật thông báo và kết quả gửi gần nhất */
pushRouter.get('/admin/devices', ...adminOnly, async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true,
      code: true,
      fullName: true,
      role: true,
      pushSubs: { select: { id: true, endpoint: true, userAgent: true, createdAt: true, updatedAt: true, lastOkAt: true, lastError: true, lastErrorAt: true } },
    },
    orderBy: { code: 'asc' },
  });
  res.json(
    users.map(({ pushSubs, ...u }) => ({
      ...u,
      devices: pushSubs.map(({ endpoint, userAgent, ...d }) => ({ ...d, device: deviceLabel(userAgent, endpoint) })),
    })),
  );
});

/** Gửi thử tới mọi thiết bị của 1 nhân sự, trả về kết quả từng thiết bị */
pushRouter.post('/admin/test', ...adminOnly, async (req, res) => {
  const { userId } = parse(z.object({ userId: z.number().int().positive() }), req.body);
  const target = await prisma.user.findUnique({ where: { id: userId }, select: { fullName: true } });
  if (!target) throw notFound();
  const results = await sendPushDetailed(userId, {
    title: 'WorkPing – thông báo thử',
    body: `${me(req).fullName} gửi thử tới ${target.fullName}. Nhận được là thông báo đã hoạt động 🎉`,
    url: '/notifications',
    tag: 'admin-test',
  });
  res.json({ devices: results.length, sent: results.filter((r) => r.ok).length, results });
});

/** Máy chủ có ra được Internet tới dịch vụ push của Apple / Google / Mozilla không */
pushRouter.post('/admin/connectivity', ...adminOnly, async (_req, res) => {
  res.json({ proxy: config.pushProxy || null, vapidSubject: config.vapidSubject, results: await checkPushConnectivity() });
});
