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

/** Lỗi bật thông báo kèm hướng dẫn tiếng Việt */
export class PushSetupError extends Error {
  hint: string;
  constructor(message: string, hint: string) {
    super(message);
    this.hint = hint;
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, err: () => Error): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(err()), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

const ua = () => navigator.userAgent;
const isCocCoc = () => /coc_coc_browser/i.test(ua());
const isEdge = () => /Edg\//.test(ua());
const isFirefox = () => /Firefox\//.test(ua());
const isBrave = () => !!(navigator as Navigator & { brave?: unknown }).brave;

/** Hướng dẫn khi trình duyệt không đăng ký được với dịch vụ push của hãng */
function pushServiceHint(): string {
  if (isBrave()) return 'Brave tắt dịch vụ thông báo mặc định: mở brave://settings/privacy → bật "Use Google services for push messaging" → tải lại trang và bật lại.';
  if (isCocCoc()) return 'Cốc Cốc không hỗ trợ ổn định thông báo đẩy. Hãy dùng Microsoft Edge hoặc Google Chrome.';
  if (isEdge()) return 'Edge cần kết nối tới dịch vụ thông báo của Microsoft (*.notify.windows.com, cổng 443). Nếu mạng cơ quan chặn: nhờ bộ phận mạng mở, hoặc thử mạng khác (4G).';
  if (isFirefox()) return 'Firefox cần kết nối tới push.services.mozilla.com (cổng 443). Nếu mạng cơ quan chặn: thử Microsoft Edge hoặc mạng khác.';
  return (
    'Chrome cần kết nối tới máy chủ thông báo của Google — mạng cơ quan thường chặn. Cách xử lý: ' +
    '(1) dùng Microsoft Edge (dùng dịch vụ của Microsoft, ít bị chặn hơn); ' +
    '(2) hoặc nhờ bộ phận mạng mở cho máy tính: mtalk.google.com cổng 5228 và 443, android.clients.google.com, fcm.googleapis.com, fcmregistrations.googleapis.com (cổng 443).'
  );
}

/** Service worker (chạy nền, nhận thông báo) — đăng ký nếu chưa có, chờ tối đa 10 giây */
async function readyRegistration(): Promise<ServiceWorkerRegistration> {
  if (!(await navigator.serviceWorker.getRegistration())) {
    try {
      await navigator.serviceWorker.register('/sw.js');
    } catch (e) {
      // Mở bằng IP / chứng chỉ không khớp → trình duyệt cấm service worker
      if (/SSL|certificate/i.test((e as Error)?.message ?? '')) {
        throw new PushSetupError(
          `Trình duyệt chặn vì lỗi chứng chỉ bảo mật: đang mở bằng ${location.host}, chứng chỉ chỉ hợp lệ với tên miền.`,
          'Mở WorkPing bằng tên miền (vd https://nbpc.evn.vn:8888) thay cho địa chỉ IP rồi bật lại. Trong mạng nội bộ không mở được tên miền: nhờ bộ phận mạng thêm DNS nội bộ trỏ tên miền về IP máy chủ, hoặc thêm dòng "<IP máy chủ> <tên miền>" vào file C:\\Windows\\System32\\drivers\\etc\\hosts.',
        );
      }
      throw e;
    }
  }
  return withTimeout(
    navigator.serviceWorker.ready,
    10_000,
    () => new PushSetupError('Bộ nhận thông báo nền (service worker) chưa khởi động được', 'Tải lại trang bằng Ctrl+F5 rồi bấm Bật thông báo lần nữa. Không dùng chế độ ẩn danh (Incognito/InPrivate).'),
  );
}

/** Trình duyệt đăng ký với dịch vụ push của hãng — có thể treo mãi nếu mạng chặn → giới hạn 20 giây */
async function browserSubscribe(reg: ServiceWorkerRegistration, key: string): Promise<PushSubscription> {
  try {
    return await withTimeout(
      reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(key) }),
      20_000,
      () => new PushSetupError('Trình duyệt không kết nối được dịch vụ thông báo của hãng (quá 20 giây)', pushServiceHint()),
    );
  } catch (e) {
    if (e instanceof PushSetupError) throw e;
    const msg = (e as Error)?.message ?? String(e);
    if (/incognito|private/i.test(msg)) throw new PushSetupError('Chế độ ẩn danh không nhận được thông báo', 'Mở trang bằng cửa sổ thường (không phải Incognito/InPrivate).');
    if (/push service|Registration failed|AbortError/i.test(msg) || (e as Error)?.name === 'AbortError') {
      throw new PushSetupError(`Trình duyệt không đăng ký được dịch vụ thông báo: ${msg}`, pushServiceHint());
    }
    throw e;
  }
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
async function subscribeAndSave(fresh = false): Promise<{ needsRefresh?: boolean }> {
  const reg = await readyRegistration();
  const key = await preloadPushKey();
  let sub = await reg.pushManager.getSubscription();
  let usedKey: string | null = null;
  if (sub) {
    const raw = sub.options?.applicationServerKey;
    const cur = raw ? btoa(String.fromCharCode(...new Uint8Array(raw))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : null;
    const saved = storedKey();
    usedKey = cur ?? saved;
    // Khoá máy chủ khác với lúc đăng ký → dịch vụ push (Apple) sẽ từ chối (BadJwtToken) → đăng ký lại
    if (fresh || (cur && cur !== key) || (saved && saved !== key)) {
      // Gỡ đăng ký cũ ở máy chủ trước, rồi tạo đăng ký mới (endpoint mới)
      await api.post('/push/unsubscribe', { endpoint: sub.endpoint }).catch(() => undefined);
      await sub.unsubscribe();
      sub = null;
    }
  }
  if (!sub) {
    sub = await browserSubscribe(reg, key);
    usedKey = key;
  }
  try {
    // Chỉ ghi khi chắc chắn đăng ký dùng khoá hiện tại (không che mất đăng ký cũ chưa rõ khoá)
    if (usedKey === key) localStorage.setItem(KEY_STORE, key);
  } catch {
    /* bỏ qua */
  }
  // Báo khoá đã dùng khi đăng ký → máy chủ phát hiện đăng ký bằng khoá cũ (Apple báo BadJwtToken)
  return api.post<{ needsRefresh?: boolean }>('/push/subscribe', { subscription: sub.toJSON(), userAgent: navigator.userAgent.slice(0, 500), appServerKey: usedKey });
}

/** Máy tính (không phải điện thoại/máy tính bảng) */
export const isDesktop = () => !isIOS() && !isAndroid() && !/Mobi|Tablet/i.test(navigator.userAgent);

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
    const r = await subscribeAndSave();
    // Máy chủ báo đăng ký này bị dịch vụ push từ chối (khoá cũ) → tự tạo đăng ký mới
    if (r.needsRefresh) await subscribeAndSave(true);
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
