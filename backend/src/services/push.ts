import crypto from 'node:crypto';
import webpush, { WebPushError } from 'web-push';
import { config } from '../config';
import { prisma } from '../lib/prisma';

/**
 * Thông báo đẩy theo chuẩn Web Push (VAPID) — không cần Firebase hay tài khoản Apple/Google Developer.
 * Hoạt động với: Safari iOS/iPadOS 16.4+ (web đã "Thêm vào Màn hình chính"), Chrome/Edge Android,
 * trình duyệt máy tính. Yêu cầu trang web chạy HTTPS.
 */
interface Vapid {
  publicKey: string;
  privateKey: string;
}

let vapid: Vapid | null = null;

/** Khoá VAPID: lấy từ biến môi trường, nếu không có thì sinh 1 lần và lưu trong CSDL */
export async function getVapid(): Promise<Vapid> {
  if (vapid) return vapid;
  if (config.vapidPublicKey && config.vapidPrivateKey) {
    vapid = { publicKey: config.vapidPublicKey, privateKey: config.vapidPrivateKey };
  } else {
    const row = await prisma.appSetting.findUnique({ where: { key: 'vapid' } });
    if (row) vapid = JSON.parse(row.value) as Vapid;
    else {
      const keys = webpush.generateVAPIDKeys();
      // createMany + skipDuplicates: an toàn khi nhiều tiến trình khởi động cùng lúc
      await prisma.appSetting.createMany({ data: [{ key: 'vapid', value: JSON.stringify(keys) }], skipDuplicates: true });
      vapid = JSON.parse((await prisma.appSetting.findUniqueOrThrow({ where: { key: 'vapid' } })).value) as Vapid;
      console.log('[push] Đã sinh khoá VAPID mới');
    }
  }
  return vapid;
}

/**
 * "sub" của VAPID: Apple từ chối (BadJwtToken) địa chỉ mẫu / localhost / sai định dạng
 * → tự dùng https://<tên miền công khai> nếu có.
 */
let preferDomainSubject = false;
const domainSubject = () => (config.publicDomain && !/^[\d.]+$/.test(config.publicDomain) ? `https://${config.publicDomain}` : null);

export function vapidSubject(): string {
  if (preferDomainSubject && domainSubject()) return domainSubject()!;
  const s = config.vapidSubject.trim();
  let valid = false;
  try {
    const u = new URL(s);
    const host = u.protocol === 'mailto:' ? (u.pathname.split('@')[1] ?? '') : u.hostname;
    valid = (u.protocol === 'mailto:' || u.protocol === 'https:') && /\./.test(host) && !/(^|\.)(example\.(com|org|net)|localhost)$/i.test(host);
  } catch {
    valid = false;
  }
  if (valid) return s;
  return domainSubject() ?? s;
}

/** Dùng trong kiểm thử */
export function resetPushState() {
  preferDomainSubject = false;
  clockSkewMs = 0;
}

/**
 * Độ lệch đồng hồ máy chủ so với giờ thật (ms, dương = máy chủ chạy nhanh).
 * Đo từ header Date của dịch vụ push. Máy chủ nội bộ bị chặn NTP hay lệch giờ → token VAPID bị Apple coi là
 * hết hạn / hạn quá xa → 403 BadJwtToken. Tự bù độ lệch khi ký token.
 */
let clockSkewMs = 0;
export const getClockSkewMs = () => clockSkewMs;
/** Cập nhật độ lệch từ header Date (độ phân giải 1 giây → bỏ qua lệch < 30 giây) */
export function observeServerDate(date: string | undefined | null): number | null {
  const t = date ? Date.parse(date) : NaN;
  if (!Number.isFinite(t)) return null;
  const diff = Date.now() - t;
  clockSkewMs = Math.abs(diff) > 30_000 ? diff : 0;
  return diff;
}

/** Ký token VAPID (ES256) theo giờ đã bù lệch, hạn 12 giờ (Apple chấp nhận tối đa 24 giờ) */
export function vapidAuthorization(endpoint: string, v: Vapid): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const now = Math.floor((Date.now() - clockSkewMs) / 1000);
  const unsigned = `${b64({ typ: 'JWT', alg: 'ES256' })}.${b64({ aud: new URL(endpoint).origin, exp: now + 12 * 3600, sub: vapidSubject() })}`;
  const pub = Buffer.from(v.publicKey, 'base64url');
  const key = crypto.createPrivateKey({
    key: { kty: 'EC', crv: 'P-256', d: v.privateKey, x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33, 65).toString('base64url') },
    format: 'jwk',
  });
  const sig = crypto.sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${sig.toString('base64url')}, k=${v.publicKey}`;
}

export interface PushPayload {
  title: string;
  body: string;
  /** Trang mở ra khi bấm thông báo */
  url?: string;
  /** Thông báo cùng tag sẽ thay thế nhau thay vì chồng lên */
  tag?: string;
  /** Số hiển thị trên biểu tượng ứng dụng (số thông báo chưa đọc) */
  badge?: number;
}

/**
 * Chỉ nhận địa chỉ của dịch vụ push chính thức (Apple, Google, Mozilla, Microsoft).
 * Không kiểm tra → kẻ xấu đăng ký địa chỉ nội bộ và dùng máy chủ để gửi request vào mạng nội bộ (SSRF).
 */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^([a-z0-9-]+\.)*push\.apple\.com$/, /^([a-z0-9-]+\.)*push\.services\.mozilla\.com$/, /^([a-z0-9-]+\.)*notify\.windows\.com$/];
export function isAllowedPushEndpoint(raw: string): boolean {
  if (config.pushAllowAnyEndpoint) return true;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && !u.port && PUSH_HOSTS.some((re) => re.test(u.hostname));
  } catch {
    return false;
  }
}

export interface DeviceResult {
  id: number;
  device: string;
  ok: boolean;
  error?: string;
}

/** Tên thiết bị dễ đọc từ User-Agent */
export function deviceLabel(ua: string | null | undefined, endpoint = ''): string {
  const u = ua ?? '';
  const os = /iPhone/.test(u) ? 'iPhone' : /iPad/.test(u) ? 'iPad' : /Android/.test(u) ? 'Android' : /Windows/.test(u) ? 'Windows' : /Mac OS X|Macintosh/.test(u) ? 'Mac' : /Linux/.test(u) ? 'Linux' : '';
  const br = /Edg\//.test(u) ? 'Edge' : /Firefox\//.test(u) ? 'Firefox' : /CriOS|Chrome\//.test(u) ? 'Chrome' : /Safari\//.test(u) ? 'Safari' : '';
  if (os || br) return [os, br].filter(Boolean).join(' · ');
  return endpoint.includes('apple.com') ? 'Thiết bị Apple' : endpoint.includes('googleapis') ? 'Chrome/Android' : 'Trình duyệt';
}

/** Giải thích lỗi gửi push bằng tiếng Việt, kèm cách xử lý */
export function explainPushError(e: unknown, endpoint: string): string {
  const host = (() => {
    try {
      return new URL(endpoint).hostname;
    } catch {
      return 'dịch vụ push';
    }
  })();
  if (e instanceof WebPushError) {
    const body = (e.body || '').slice(0, 150);
    if (e.statusCode === 404 || e.statusCode === 410) return `${e.statusCode}: thiết bị đã gỡ ứng dụng hoặc tắt thông báo — người dùng cần bật lại`;
    if (e.statusCode === 403 || e.statusCode === 401) {
      const skew = Math.round(clockSkewMs / 1000);
      return (
        `${e.statusCode} ${body}: dịch vụ push từ chối chữ ký VAPID. ` +
        (skew ? `Đồng hồ máy chủ lệch ${skew} giây (đã tự bù) — nên bật đồng bộ giờ: sudo timedatectl set-ntp true. ` : '') +
        `VAPID_SUBJECT đang dùng: "${vapidSubject()}". ` +
        'Thường do thiết bị giữ đăng ký cũ (tạo bằng khoá khác): chỉ cần MỞ WorkPing trên thiết bị đó, ứng dụng sẽ tự đăng ký lại; ' +
        'hoặc vào mục Thông báo → bấm "Đăng ký lại".'
      );
    }
    if (e.statusCode === 413) return '413: nội dung thông báo quá dài';
    if (e.statusCode === 429) return '429: gửi quá nhiều, dịch vụ push tạm chặn';
    return `${e.statusCode} ${body}`;
  }
  const err = e as NodeJS.ErrnoException;
  const code = err?.code ?? '';
  const net = ['ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH', 'ESOCKETTIMEDOUT'];
  if (net.includes(code) || /timeout|socket hang up/i.test(err?.message ?? '')) {
    return `${code || 'Hết thời gian chờ'}: máy chủ không kết nối được tới ${host}:443 — mở tường lửa cho máy chủ đi ra Internet, hoặc đặt PUSH_PROXY=http://proxy:cổng trong /etc/workping/workping.env rồi restart`;
  }
  return `${code ? code + ': ' : ''}${err?.message ?? String(e)}`.slice(0, 300);
}

/** Gửi tới mọi thiết bị của user, trả về kết quả từng thiết bị (và lưu lại để quản trị xem) */
export async function sendPushDetailed(userId: number, p: PushPayload): Promise<DeviceResult[]> {
  const all = await prisma.webPushSubscription.findMany({ where: { userId } });
  // Bỏ các đăng ký có địa chỉ lạ (vd tạo trước khi có kiểm tra)
  const bad = all.filter((s) => !isAllowedPushEndpoint(s.endpoint));
  if (bad.length) await prisma.webPushSubscription.deleteMany({ where: { id: { in: bad.map((s) => s.id) } } });
  const subs = all.filter((s) => isAllowedPushEndpoint(s.endpoint));
  if (!subs.length) return [];
  const v = await getVapid();
  const payload = JSON.stringify(p);
  const send = async (s: (typeof subs)[number]) => {
    const r = await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
      TTL: 24 * 3600,
      urgency: 'high',
      timeout: 15_000,
      // Tự ký token VAPID (để bù lệch đồng hồ) — không gọi webpush.setVapidDetails để thư viện không ghi đè
      headers: { Authorization: vapidAuthorization(s.endpoint, v) },
      ...(config.pushProxy ? { proxy: config.pushProxy } : {}),
    });
    observeServerDate(r.headers?.date);
  };
  return Promise.all(
    subs.map(async (s): Promise<DeviceResult> => {
      const device = deviceLabel(s.userAgent, s.endpoint);
      try {
        try {
          await send(s);
        } catch (e) {
          if (!(e instanceof WebPushError && (e.statusCode === 401 || e.statusCode === 403))) throw e;
          // Bị từ chối token: (1) lệch giờ → đo lại từ header Date, bù và gửi lại
          const before = clockSkewMs;
          observeServerDate(e.headers?.date);
          let last: unknown = e;
          if (clockSkewMs !== before) {
            console.warn(`[push] đồng hồ máy chủ lệch ${Math.round(clockSkewMs / 1000)} giây — đã tự bù, gửi lại`);
            try {
              await send(s);
              last = null;
            } catch (e2) {
              last = e2;
            }
          }
          // (2) thử subject dạng https://tên-miền (phòng dịch vụ push không nhận email)
          if (last && !preferDomainSubject && domainSubject() && domainSubject() !== vapidSubject()) {
            preferDomainSubject = true;
            try {
              await send(s);
              console.warn(`[push] dịch vụ push không nhận VAPID_SUBJECT "${config.vapidSubject}" — chuyển sang ${domainSubject()}`);
              last = null;
            } catch (e3) {
              preferDomainSubject = false;
              last = e3;
            }
          }
          if (last) throw last;
        }
        await prisma.webPushSubscription.updateMany({ where: { id: s.id }, data: { lastOkAt: new Date(), lastError: null, lastErrorAt: null } });
        return { id: s.id, device, ok: true };
      } catch (e) {
        const error = explainPushError(e, s.endpoint);
        // 404/410: người dùng đã gỡ ứng dụng / thu hồi quyền → xoá đăng ký
        if (e instanceof WebPushError && (e.statusCode === 404 || e.statusCode === 410)) {
          await prisma.webPushSubscription.deleteMany({ where: { id: s.id } });
        } else {
          await prisma.webPushSubscription.updateMany({ where: { id: s.id }, data: { lastError: error, lastErrorAt: new Date() } });
          console.error(`[push] gửi thất bại user=${userId} ${device}: ${error}`);
        }
        return { id: s.id, device, ok: false, error };
      }
    }),
  );
}

/** Đăng ký bị dịch vụ push từ chối chữ ký (401/403) ở lần gửi gần nhất → thiết bị cần đăng ký lại */
export function needsRefresh(sub: { lastError: string | null; lastErrorAt: Date | null; lastOkAt: Date | null }): boolean {
  return !!sub.lastError && /^(401|403)\b/.test(sub.lastError) && !!sub.lastErrorAt && (!sub.lastOkAt || sub.lastErrorAt > sub.lastOkAt);
}

/** Gửi tới mọi trình duyệt/thiết bị user đã bật thông báo. Trả về số lần gửi thành công. */
export async function sendPushToUser(userId: number, p: PushPayload): Promise<number> {
  return (await sendPushDetailed(userId, p)).filter((r) => r.ok).length;
}

/** Máy chủ có kết nối được tới các dịch vụ push không (đi qua PUSH_PROXY nếu có) */
export async function checkPushConnectivity(): Promise<{ host: string; ok: boolean; ms: number; error?: string; clockSkewSec?: number }[]> {
  const { HttpsProxyAgent } = await import('https-proxy-agent');
  const https = await import('node:https');
  const agent = config.pushProxy ? new HttpsProxyAgent(config.pushProxy) : undefined;
  const hosts = ['web.push.apple.com', 'fcm.googleapis.com', 'updates.push.services.mozilla.com'];
  return Promise.all(
    hosts.map(
      (host) =>
        new Promise<{ host: string; ok: boolean; ms: number; error?: string; clockSkewSec?: number }>((resolve) => {
          const t0 = Date.now();
          const req = https.request({ host, port: 443, method: 'GET', path: '/', agent, timeout: 8000 }, (res) => {
            res.resume();
            // Có phản hồi HTTP (kể cả 404/405) = kết nối được; header Date cho biết đồng hồ máy chủ có lệch không
            const diff = observeServerDate(res.headers.date);
            resolve({ host, ok: true, ms: Date.now() - t0, ...(diff !== null ? { clockSkewSec: Math.round(diff / 1000) } : {}) });
          });
          req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
          req.on('error', (e) => resolve({ host, ok: false, ms: Date.now() - t0, error: explainPushError(e, `https://${host}/`) }));
          req.end();
        }),
    ),
  );
}
