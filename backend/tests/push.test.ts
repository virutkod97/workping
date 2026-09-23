import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ece = require('http_ece') as { decrypt: (buf: Buffer, opts: Record<string, unknown>) => Buffer };
import { as, day, org, prisma, resetDb } from './helpers';

/**
 * Giả lập dịch vụ push của trình duyệt (như web.push.apple.com / fcm.googleapis.com) bằng HTTPS server cục bộ,
 * dùng cặp khoá thật để giải mã nội dung → kiểm tra trọn chuỗi mã hoá + ký VAPID của thư viện web-push.
 */
let server: https.Server;
let base = '';
let nextStatus = 201;
const received: { path: string; headers: Record<string, unknown>; body: Buffer }[] = [];

beforeAll(async () => {
  process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'push-'));
  execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${dir}/k.pem -out ${dir}/c.pem -days 1 -subj /CN=localhost`, { stdio: 'ignore' });
  server = https.createServer({ key: fs.readFileSync(`${dir}/k.pem`), cert: fs.readFileSync(`${dir}/c.pem`) }, (req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      received.push({ path: req.url!, headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(nextStatus).end();
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `https://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());
beforeEach(async () => {
  await resetDb();
  received.length = 0;
  nextStatus = 201;
});

function browserKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return { ecdh, auth, keys: { p256dh: ecdh.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } };
}

const decrypt = (body: Buffer, k: ReturnType<typeof browserKeys>) =>
  JSON.parse(ece.decrypt(body, { version: 'aes128gcm', privateKey: k.ecdh, authSecret: k.auth.toString('base64url') }).toString('utf8'));

const waitFor = async (n: number) => {
  for (let i = 0; i < 50 && received.length < n; i++) await new Promise((r) => setTimeout(r, 50));
};

describe('Web Push (PWA)', () => {
  it('bật thông báo → giao việc → trình duyệt nhận được nội dung đã mã hoá đúng', async () => {
    const { head, depA } = await org();
    const pk = await as(depA).get('/api/push/public-key');
    expect(pk.body.publicKey).toMatch(/^[A-Za-z0-9_-]{80,}$/);
    // Khoá VAPID sinh 1 lần, lần sau trả lại đúng khoá cũ
    expect((await as(head).get('/api/push/public-key')).body.publicKey).toBe(pk.body.publicKey);

    const k = browserKeys();
    const sub = await as(depA).post('/api/push/subscribe', { subscription: { endpoint: `${base}/push/dep-a`, keys: k.keys }, userAgent: 'iPhone Safari' });
    expect(sub.status).toBe(200);

    const t = await as(head).post('/api/tasks', { title: 'Rà soát hồ sơ', ownerId: depA.id, dueDate: day(5) });
    await waitFor(1);
    expect(received).toHaveLength(1);
    const r = received[0];
    expect(r.path).toBe('/push/dep-a');
    expect(r.headers['content-encoding']).toBe('aes128gcm');
    expect(r.headers.urgency).toBe('high');
    expect(String(r.headers.authorization)).toMatch(/^vapid t=.+, k=/);
    const msg = decrypt(r.body, k);
    expect(msg).toMatchObject({ title: 'Việc mới được giao: CV001', url: `/tasks/${t.body.id}`, badge: 1 });
    expect(msg.body).toContain('Rà soát hồ sơ');
  });

  it('dịch vụ push trả 410 (đã gỡ app / thu hồi quyền) → tự xoá đăng ký', async () => {
    const { head, depA } = await org();
    const k = browserKeys();
    await as(depA).post('/api/push/subscribe', { subscription: { endpoint: `${base}/push/gone`, keys: k.keys } });
    nextStatus = 410;
    await as(head).post('/api/tasks', { title: 'X', ownerId: depA.id });
    await waitFor(1);
    for (let i = 0; i < 20 && (await prisma.webPushSubscription.count()) > 0; i++) await new Promise((r) => setTimeout(r, 50));
    expect(await prisma.webPushSubscription.count()).toBe(0);
  });

  it('cùng thiết bị đăng nhập tài khoản khác → đăng ký chuyển sang tài khoản mới; đăng xuất thì gỡ', async () => {
    const { head, depA } = await org();
    const k = browserKeys();
    const subscription = { endpoint: `${base}/push/shared`, keys: k.keys };
    await as(depA).post('/api/push/subscribe', { subscription });
    await as(head).post('/api/push/subscribe', { subscription });
    expect(await prisma.webPushSubscription.findMany({ select: { userId: true } })).toEqual([{ userId: head.id }]);
    const test = await as(head).post('/api/push/test');
    expect(test.body).toMatchObject({ devices: 1, sent: 1 });
    await as(head).post('/api/push/unsubscribe', { endpoint: subscription.endpoint });
    expect(await prisma.webPushSubscription.count()).toBe(0);
  });

  it('mọi đường giao việc cho nhân viên đều đẩy thông báo: TP giao thẳng, PTP giao bổ sung', async () => {
    const { head, depA, staffA } = await org();
    const k = browserKeys();
    await as(staffA).post('/api/push/subscribe', { subscription: { endpoint: `${base}/push/staff`, keys: k.keys }, userAgent: 'Android Chrome' });

    // 1. Trưởng phòng giao thẳng cho nhân viên
    await as(head).post('/api/tasks', { title: 'Việc giao thẳng', ownerId: staffA.id });
    await waitFor(1);
    await new Promise((r) => setTimeout(r, 300));
    // Đúng 1 thông báo (trước đây nhận 2 cái trùng nhau)
    expect(received.map((r) => decrypt(r.body, k).title)).toEqual(['Việc mới được giao: CV001']);

    // 2. Phó phòng giao bổ sung mốc cho nhân viên
    received.length = 0;
    const t = await as(head).post('/api/tasks', { title: 'Báo cáo', ownerId: depA.id });
    const add = await as(depA).post(`/api/milestones/${t.body.milestones[0].id}/members`, { userIds: [staffA.id] });
    expect(add.status).toBe(200);
    await waitFor(1);
    expect(received.map((r) => decrypt(r.body, k).title)).toContain('Được giao việc CV002');
  });

  it('quản trị: xem thiết bị, gửi thử từng người, lưu lý do lỗi', async () => {
    const { head, staffA, staffB } = await org();
    const k = browserKeys();
    await as(staffA).post('/api/push/subscribe', { subscription: { endpoint: `${base}/push/a`, keys: k.keys }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) Safari/604.1' });

    expect((await as(staffA).get('/api/push/admin/devices')).status).toBe(403);
    expect((await as(staffA).post('/api/push/admin/test', { userId: staffB.id })).status).toBe(403);

    const list = await as(head).get('/api/push/admin/devices');
    const rowA = list.body.find((u: { id: number }) => u.id === staffA.id);
    expect(rowA.devices).toHaveLength(1);
    expect(rowA.devices[0].device).toBe('iPhone · Safari');
    expect(list.body.find((u: { id: number }) => u.id === staffB.id).devices).toHaveLength(0);

    // Gửi thành công
    const ok = await as(head).post('/api/push/admin/test', { userId: staffA.id });
    expect(ok.body).toMatchObject({ devices: 1, sent: 1, results: [{ ok: true, device: 'iPhone · Safari' }] });
    expect(decrypt(received[0].body, k).title).toBe('WorkPing – thông báo thử');

    // Dịch vụ push từ chối khoá → lỗi được giải thích và lưu lại
    nextStatus = 403;
    const bad = await as(head).post('/api/push/admin/test', { userId: staffA.id });
    expect(bad.body.sent).toBe(0);
    expect(bad.body.results[0].error).toMatch(/VAPID_SUBJECT/);
    const after = await as(head).get('/api/push/admin/devices');
    const d = after.body.find((u: { id: number }) => u.id === staffA.id).devices[0];
    expect(d.lastError).toMatch(/VAPID_SUBJECT/);
    expect(d.lastOkAt).toBeTruthy();

    // Người chưa bật thông báo
    expect((await as(head).post('/api/push/admin/test', { userId: staffB.id })).body).toMatchObject({ devices: 0, sent: 0 });
  });

  it('không kết nối được dịch vụ push → báo lỗi mạng kèm hướng dẫn PUSH_PROXY', async () => {
    const { head, staffA } = await org();
    const k = browserKeys();
    await as(staffA).post('/api/push/subscribe', { subscription: { endpoint: 'https://127.0.0.1:1/push/x', keys: k.keys } });
    const r = await as(head).post('/api/push/admin/test', { userId: staffA.id });
    expect(r.body.results[0].ok).toBe(false);
    expect(r.body.results[0].error).toMatch(/ECONNREFUSED.*PUSH_PROXY/);
  });
});
