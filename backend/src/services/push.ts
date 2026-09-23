import fs from 'node:fs';
import { cert, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getMessaging } from 'firebase-admin/messaging';
import { config } from '../config';
import { prisma } from '../lib/prisma';

let app: App | null | undefined;

function firebaseApp(): App | null {
  if (app !== undefined) return app;
  try {
    let json: string | null = null;
    if (config.firebaseServiceAccountBase64) {
      json = Buffer.from(config.firebaseServiceAccountBase64, 'base64').toString('utf8');
    } else if (config.firebaseServiceAccountPath && fs.existsSync(config.firebaseServiceAccountPath)) {
      json = fs.readFileSync(config.firebaseServiceAccountPath, 'utf8');
    }
    if (!json) {
      console.warn('[push] Chưa cấu hình Firebase service account — chỉ lưu thông báo trong ứng dụng.');
      app = null;
      return app;
    }
    app = getApps()[0] ?? initializeApp({ credential: cert(JSON.parse(json)) });
    console.log('[push] Firebase Admin đã khởi tạo');
  } catch (e) {
    console.error('[push] Lỗi khởi tạo Firebase:', e);
    app = null;
  }
  return app;
}

export function pushEnabled() {
  return firebaseApp() !== null;
}

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  badge?: number;
}

const INVALID_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  'messaging/invalid-argument',
]);

/** Gửi push FCM tới mọi thiết bị của user (Android + iOS qua APNs) */
export async function sendPushToUser(userId: number, p: PushPayload): Promise<number> {
  const fb = firebaseApp();
  if (!fb) return 0;
  const devices = await prisma.deviceToken.findMany({ where: { userId }, select: { token: true } });
  if (!devices.length) return 0;
  const tokens = devices.map((d) => d.token);
  const res = await getMessaging(fb).sendEachForMulticast({
    tokens,
    notification: { title: p.title, body: p.body },
    data: p.data,
    android: {
      priority: 'high',
      notification: { sound: 'default' },
    },
    apns: {
      headers: { 'apns-priority': '10' },
      payload: { aps: { sound: 'default', badge: p.badge } },
    },
  });
  const invalid: string[] = [];
  res.responses.forEach((r, i) => {
    if (!r.success && r.error && INVALID_TOKEN_CODES.has(r.error.code)) invalid.push(tokens[i]);
  });
  if (invalid.length) await prisma.deviceToken.deleteMany({ where: { token: { in: invalid } } });
  return res.successCount;
}
