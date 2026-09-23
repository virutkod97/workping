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
  webpush.setVapidDetails(config.vapidSubject, vapid.publicKey, vapid.privateKey);
  return vapid;
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
    if (e.statusCode === 403 || e.statusCode === 401)
      return `${e.statusCode} ${body}: dịch vụ push từ chối khoá VAPID — kiểm tra VAPID_SUBJECT (phải là mailto:email-thật hoặc https://tên-miền) trong /etc/workping/workping.env`;
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
  await getVapid();
  const payload = JSON.stringify(p);
  return Promise.all(
    subs.map(async (s): Promise<DeviceResult> => {
      const device = deviceLabel(s.userAgent, s.endpoint);
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          TTL: 24 * 3600,
          urgency: 'high',
          timeout: 15_000,
          ...(config.pushProxy ? { proxy: config.pushProxy } : {}),
        });
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

/** Gửi tới mọi trình duyệt/thiết bị user đã bật thông báo. Trả về số lần gửi thành công. */
export async function sendPushToUser(userId: number, p: PushPayload): Promise<number> {
  return (await sendPushDetailed(userId, p)).filter((r) => r.ok).length;
}

/** Máy chủ có kết nối được tới các dịch vụ push không (đi qua PUSH_PROXY nếu có) */
export async function checkPushConnectivity(): Promise<{ host: string; ok: boolean; ms: number; error?: string }[]> {
  const { HttpsProxyAgent } = await import('https-proxy-agent');
  const https = await import('node:https');
  const agent = config.pushProxy ? new HttpsProxyAgent(config.pushProxy) : undefined;
  const hosts = ['web.push.apple.com', 'fcm.googleapis.com', 'updates.push.services.mozilla.com'];
  return Promise.all(
    hosts.map(
      (host) =>
        new Promise<{ host: string; ok: boolean; ms: number; error?: string }>((resolve) => {
          const t0 = Date.now();
          const req = https.request({ host, port: 443, method: 'GET', path: '/', agent, timeout: 8000 }, (res) => {
            res.resume();
            // Có phản hồi HTTP (kể cả 404/405) = kết nối được
            resolve({ host, ok: true, ms: Date.now() - t0 });
          });
          req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
          req.on('error', (e) => resolve({ host, ok: false, ms: Date.now() - t0, error: explainPushError(e, `https://${host}/`) }));
          req.end();
        }),
    ),
  );
}
