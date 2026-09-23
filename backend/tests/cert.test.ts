import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import tls from 'node:tls';
import type { AddressInfo } from 'node:net';
import { config } from '../src/config';
import { clearCertCache, getCertStatus, notifyCertExpiry } from '../src/services/cert';
import { as, org, mkUser, prisma, resetDb } from './helpers';

/** Giả lập nginx phục vụ HTTPS bằng chứng chỉ còn 10 ngày */
let server: tls.Server;
let sni: string | undefined;

beforeAll(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cert-'));
  execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${dir}/k.pem -out ${dir}/c.pem -days 10 -subj /CN=wp.test`, { stdio: 'ignore' });
  const ctx = { key: fs.readFileSync(`${dir}/k.pem`), cert: fs.readFileSync(`${dir}/c.pem`) };
  server = tls.createServer({ ...ctx, SNICallback: (name, cb) => ((sni = name), cb(null, tls.createSecureContext(ctx))) }, (s) => s.end());
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  Object.assign(config, { certMode: 'le', publicDomain: 'wp.test', httpsPort: (server.address() as AddressInfo).port, certWarnDays: 30 });
});
afterAll(() => {
  server.close();
  Object.assign(config, { certMode: '' });
});
beforeEach(async () => {
  await resetDb();
  clearCertCache();
});

describe('Cảnh báo chứng chỉ HTTPS', () => {
  it('đọc hạn chứng chỉ nginx đang phục vụ (đúng tên miền SNI)', async () => {
    const s = await getCertStatus();
    expect(s).toMatchObject({ enabled: true, mode: 'le', domain: 'wp.test', warn: true });
    expect(s.daysLeft).toBeGreaterThanOrEqual(9);
    expect(s.daysLeft).toBeLessThanOrEqual(10);
    expect(sni).toBe('wp.test');
  });

  it('không cảnh báo khi còn nhiều ngày hơn ngưỡng', async () => {
    config.certWarnDays = 5;
    try {
      expect((await getCertStatus(true)).warn).toBe(false);
      expect(await notifyCertExpiry()).toBe(0);
    } finally {
      config.certWarnDays = 30;
    }
  });

  it('chỉ Quản trị / Trưởng phòng xem được; báo 1 lần mỗi mốc', async () => {
    const { head, depA, staffA } = await org();
    const admin = await mkUser('ADM', 'ADMIN');
    expect((await as(staffA).get('/api/system/cert')).status).toBe(403);
    expect((await as(depA).get('/api/system/cert')).status).toBe(403);
    const r = await as(head).get('/api/system/cert?refresh=1');
    expect(r.status).toBe(200);
    expect(r.body.warn).toBe(true);

    expect(await notifyCertExpiry()).toBe(2);
    expect(await notifyCertExpiry()).toBe(0);
    const n = await prisma.notification.findMany({ where: { type: 'SYSTEM' } });
    expect(n.map((x) => x.userId).sort()).toEqual([head.id, admin.id].sort());
    expect(n[0].title).toMatch(/Chứng chỉ HTTPS còn \d+ ngày/);
    expect(n[0].body).toContain('cổng 80');
  });

  it('không kết nối được → trả lỗi, không gửi thông báo', async () => {
    const port = config.httpsPort;
    config.httpsPort = 1;
    try {
      const s = await getCertStatus(true);
      expect(s.enabled).toBe(true);
      expect(s.error).toBeTruthy();
      expect(s.warn).toBe(false);
      expect(await notifyCertExpiry()).toBe(0);
    } finally {
      config.httpsPort = port;
    }
  });
});
