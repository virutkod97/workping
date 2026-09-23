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

/** Gửi tới mọi trình duyệt/thiết bị user đã bật thông báo. Trả về số lần gửi thành công. */
export async function sendPushToUser(userId: number, p: PushPayload): Promise<number> {
  const all = await prisma.webPushSubscription.findMany({ where: { userId } });
  // Bỏ các đăng ký có địa chỉ lạ (vd tạo trước khi có kiểm tra)
  const bad = all.filter((s) => !isAllowedPushEndpoint(s.endpoint));
  if (bad.length) await prisma.webPushSubscription.deleteMany({ where: { id: { in: bad.map((s) => s.id) } } });
  const subs = all.filter((s) => isAllowedPushEndpoint(s.endpoint));
  if (!subs.length) return 0;
  await getVapid();
  const payload = JSON.stringify(p);
  let ok = 0;
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } }, payload, {
          TTL: 24 * 3600,
          urgency: 'high',
          timeout: 15_000,
          ...(config.pushProxy ? { proxy: config.pushProxy } : {}),
        });
        ok++;
      } catch (e) {
        // 404/410: người dùng đã gỡ ứng dụng / thu hồi quyền → xoá đăng ký
        if (e instanceof WebPushError && (e.statusCode === 404 || e.statusCode === 410)) {
          await prisma.webPushSubscription.deleteMany({ where: { endpoint: s.endpoint } });
        } else {
          console.error('[push] gửi thất bại', s.endpoint.slice(0, 60), e instanceof WebPushError ? `${e.statusCode} ${e.body}` : e);
        }
      }
    }),
  );
  return ok;
}
