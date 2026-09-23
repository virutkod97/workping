import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, as, mkUser, org, prisma, resetDb } from './helpers';
import { resetLoginGuard } from '../src/lib/loginGuard';
import { config } from '../src/config';

beforeEach(async () => {
  await resetDb();
  resetLoginGuard();
});

const login = (username: string, password: string, ip = '10.0.0.1') =>
  request(app).post('/api/auth/login').set('X-Forwarded-For', ip).send({ username, password });

describe('bảo mật đăng nhập', () => {
  it('sai 5 lần → khoá tài khoản đó 15 phút (kể cả nhập đúng), IP khác vẫn đăng nhập được', async () => {
    await mkUser('NS001', 'HEAD');
    for (let i = 0; i < 5; i++) expect((await login('ns001', 'sai' + i)).status).toBe(401);
    const locked = await login('ns001', 'secret123');
    expect(locked.status).toBe(429);
    expect(locked.body.error).toMatch(/quá nhiều lần/);
    expect((await login('ns001', 'secret123', '10.0.0.2')).status).toBe(200);
  });

  it('1 IP dò nhiều tài khoản → chặn IP', async () => {
    await mkUser('NS001', 'HEAD');
    for (let i = 0; i < 20; i++) await login(`khongco${i}`, 'x', '10.9.9.9');
    expect((await login('ns001', 'secret123', '10.9.9.9')).status).toBe(429);
  });

  it('đổi mật khẩu → token cũ hết hiệu lực, thiết bị đang dùng nhận token mới', async () => {
    const u = await mkUser('NS001', 'HEAD');
    const old = (await login('ns001', 'secret123')).body.token;
    const weak = await as({ token: old }).post('/api/auth/change-password', { oldPassword: 'secret123', newPassword: '12345678' });
    expect(weak.status).toBe(400);
    const r = await as({ token: old }).post('/api/auth/change-password', { oldPassword: 'secret123', newPassword: 'MatKhauMoi1' });
    expect(r.status).toBe(200);
    expect((await as({ token: old }).get('/api/tasks')).status).toBe(401);
    expect((await as({ token: r.body.token }).get('/api/tasks')).status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: u.id } })).tokenVersion).toBe(1);
  });

  it('Trưởng phòng đặt lại mật khẩu → phiên của nhân sự bị đăng xuất, nhận mật khẩu tạm ngẫu nhiên', async () => {
    const { head, staffA } = await org();
    const tok = (await login(staffA.username, 'secret123')).body.token;
    const r = await as(head).post(`/api/users/${staffA.id}/reset-password`);
    expect(r.body.tempPassword).toMatch(/^[A-Za-z0-9]{10}$/);
    expect((await as({ token: tok }).get('/api/tasks')).status).toBe(401);
    // Mật khẩu tạm: chỉ đổi mật khẩu được, chưa dùng chức năng khác
    const t2 = (await login(staffA.username, r.body.tempPassword)).body.token;
    expect((await as({ token: t2 }).get('/api/tasks')).status).toBe(403);
    expect((await as({ token: t2 }).get('/api/auth/me')).status).toBe(200);
  });

  it('nhân viên không xem được tên đăng nhập của người khác', async () => {
    const { head, staffA } = await org();
    const one = await as(staffA).get(`/api/users/${head.id}`);
    expect(one.body.username).toBeUndefined();
    const list = await as(staffA).get('/api/users');
    expect(list.body.find((x: { id: number }) => x.id === head.id).username).toBeUndefined();
    expect(list.body.find((x: { id: number }) => x.id === staffA.id).username).toBe(staffA.username);
    expect((await as(head).get(`/api/users/${staffA.id}`)).body.username).toBe(staffA.username);
  });
});

describe('thông báo đẩy: chống SSRF', () => {
  const keys = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
  it('chỉ nhận địa chỉ của Apple / Google / Mozilla / Microsoft', async () => {
    const u = await mkUser('NS001', 'STAFF');
    config.pushAllowAnyEndpoint = false;
    try {
      for (const endpoint of [
        'http://127.0.0.1:5432/x',
        'https://10.0.0.5/x',
        'https://fcm.googleapis.com.evil.com/x',
        'https://fcm.googleapis.com:8443/x',
        'http://fcm.googleapis.com/fcm/send/abc',
      ]) {
        expect((await as(u).post('/api/push/subscribe', { subscription: { endpoint, keys } })).status, endpoint).toBe(400);
      }
      for (const endpoint of ['https://fcm.googleapis.com/fcm/send/abc', 'https://web.push.apple.com/QAbc', 'https://updates.push.services.mozilla.com/wpush/v2/x']) {
        expect((await as(u).post('/api/push/subscribe', { subscription: { endpoint, keys } })).status, endpoint).toBe(200);
      }
    } finally {
      config.pushAllowAnyEndpoint = true;
    }
  });
});

describe('địa chỉ chính thức', () => {
  it('trả về https://tên-miền:cổng khi có chứng chỉ, không cần đăng nhập', async () => {
    const old = { m: config.certMode, d: config.publicDomain, p: config.httpsPort };
    try {
      expect((await request(app).get('/api/public-config')).body).toEqual({ publicUrl: null });
      Object.assign(config, { certMode: 'le', publicDomain: 'nbpc.evn.vn', httpsPort: 8888 });
      expect((await request(app).get('/api/public-config')).body).toEqual({ publicUrl: 'https://nbpc.evn.vn:8888' });
    } finally {
      Object.assign(config, { certMode: old.m, publicDomain: old.d, httpsPort: old.p });
    }
  });
});

describe('header bảo mật', () => {
  it('có CSP, chống nhúng iframe, không lộ Express, không bật CORS', async () => {
    const r = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(r.headers['content-security-policy']).toContain("script-src 'self'");
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect(r.headers['access-control-allow-origin']).toBeUndefined();
  });
});
