import { api } from './api';

/** Trạng thái thông báo đẩy trên thiết bị hiện tại */
export type PushState =
  | 'insecure' // trang không chạy HTTPS
  | 'ios-install' // iPhone/iPad: phải "Thêm vào MH chính" rồi mở từ biểu tượng
  | 'ios-old' // iOS < 16.4
  | 'unsupported'
  | 'default' // chưa hỏi quyền
  | 'denied'
  | 'off' // đã cho phép nhưng chưa đăng ký
  | 'on';

export const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = () => /Android/i.test(navigator.userAgent);
export const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

function iosVersion(): number | null {
  const m = /OS (\d+)_(\d+)/.exec(navigator.userAgent);
  return m ? Number(m[1]) + Number(m[2]) / 100 : null;
}

const supported = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;

export function registerServiceWorker() {
  if ('serviceWorker' in navigator && window.isSecureContext) {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('[sw] đăng ký thất bại', e));
  }
}

async function currentSubscription(): Promise<PushSubscription | null> {
  if (!supported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

export async function getPushState(): Promise<PushState> {
  if (!window.isSecureContext) return 'insecure';
  if (isIOS()) {
    const v = iosVersion();
    if (v !== null && v < 16.04) return 'ios-old';
    if (!isStandalone()) return 'ios-install';
  }
  if (!supported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission === 'default') return 'default';
  return (await currentSubscription()) ? 'on' : 'off';
}

let publicKey: string | null = null;
/** Tải trước khoá VAPID để lúc bấm nút không phải chờ mạng (Safari cần thao tác người dùng liền mạch) */
export async function preloadPushKey() {
  if (!publicKey) publicKey = (await api.get<{ publicKey: string }>('/push/public-key')).publicKey;
  return publicKey;
}

function b64ToBytes(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Khoá máy chủ đã dùng khi đăng ký trên thiết bị này (Safari không phải lúc nào cũng trả về options.applicationServerKey) */
const KEY_STORE = 'workping_push_key';
const storedKey = () => {
  try {
    return localStorage.getItem(KEY_STORE);
  } catch {
    return null;
  }
};

/** fresh = true: luôn tạo đăng ký mới (chỉ dùng khi người dùng bấm nút — iOS cần thao tác trực tiếp) */
async function subscribeAndSave(fresh = false): Promise<void> {
  const reg = await navigator.serviceWorker.ready;
  const key = await preloadPushKey();
  let sub = await reg.pushManager.getSubscription();
  if (sub) {
    const raw = sub.options?.applicationServerKey;
    const cur = raw ? btoa(String.fromCharCode(...new Uint8Array(raw))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : null;
    const saved = storedKey();
    // Khoá máy chủ khác với lúc đăng ký → dịch vụ push (Apple) sẽ từ chối (BadJwtToken) → đăng ký lại
    if (fresh || (cur && cur !== key) || (saved && saved !== key)) {
      await sub.unsubscribe();
      sub = null;
    }
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) });
  try {
    localStorage.setItem(KEY_STORE, key);
  } catch {
    /* bỏ qua */
  }
  await api.post('/push/subscribe', { subscription: sub.toJSON(), userAgent: navigator.userAgent.slice(0, 500) });
}

/** Gọi TRỰC TIẾP trong sự kiện bấm nút (iOS yêu cầu) */
export async function enablePush(): Promise<PushState> {
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'default';
  // Bấm "Bật" = luôn tạo đăng ký mới → sửa được đăng ký hỏng / khoá cũ
  await subscribeAndSave(true);
  return 'on';
}

/** Mỗi lần mở app/đăng nhập: nếu đã cho phép thì đồng bộ đăng ký lên máy chủ (không hỏi quyền) */
export async function syncPush() {
  try {
    if (!window.isSecureContext || !supported() || Notification.permission !== 'granted') return;
    if (isIOS() && !isStandalone()) return;
    await subscribeAndSave();
  } catch (e) {
    console.warn('[push] đồng bộ thất bại', e);
  }
}

/** Tắt trên thiết bị này (và khi đăng xuất) */
export async function disablePush() {
  try {
    const sub = await currentSubscription();
    if (!sub) return;
    await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined);
    await sub.unsubscribe();
    try {
      localStorage.removeItem(KEY_STORE);
    } catch {
      /* bỏ qua */
    }
  } catch {
    /* bỏ qua */
  }
}
