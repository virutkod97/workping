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
    expect(test.body).toEqual({ devices: 1, sent: 1 });
    await as(head).post('/api/push/unsubscribe', { endpoint: subscription.endpoint });
    expect(await prisma.webPushSubscription.count()).toBe(0);
  });
});
