import { PermissionsAndroid, Platform } from 'react-native';
import {
  AuthorizationStatus,
  getInitialNotification,
  getMessaging,
  getToken,
  onMessage,
  onNotificationOpenedApp,
  onTokenRefresh,
  requestPermission,
  type RemoteMessage,
} from '@react-native-firebase/messaging';
import { api } from './api';

export interface PushData {
  title: string;
  body: string;
  taskId?: number;
}

const platform = Platform.OS === 'ios' ? 'ios' : 'android';
let currentToken: string | null = null;

function toData(m: RemoteMessage): PushData {
  const taskId = m.data?.taskId ? Number(m.data.taskId) : undefined;
  return { title: m.notification?.title ?? 'WorkPing', body: m.notification?.body ?? '', taskId };
}

async function askPermission(): Promise<boolean> {
  if (Platform.OS === 'android') {
    // Android 13+ phải xin quyền hiển thị thông báo
    if (Number(Platform.Version) >= 33) {
      const r = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
      return r === PermissionsAndroid.RESULTS.GRANTED;
    }
    return true;
  }
  const status = await requestPermission(getMessaging());
  return status === AuthorizationStatus.AUTHORIZED || status === AuthorizationStatus.PROVISIONAL;
}

/** Xin quyền, lấy FCM token và gửi lên server. Trả về hàm huỷ lắng nghe đổi token. */
export async function registerForPush(): Promise<(() => void) | undefined> {
  try {
    if (!(await askPermission())) return;
    const messaging = getMessaging();
    currentToken = await getToken(messaging); // iOS: FCM tự đổi APNs token sang FCM token
    await api.post('/devices', { token: currentToken, platform });
    return onTokenRefresh(messaging, (t) => {
      currentToken = t;
      api.post('/devices', { token: t, platform }).catch(() => undefined);
    });
  } catch (e) {
    console.warn('[push] Không đăng ký được thông báo đẩy:', e);
  }
}

/** Gỡ token khỏi tài khoản khi đăng xuất */
export async function unregisterPush() {
  try {
    const t = currentToken ?? (await getToken(getMessaging()));
    if (t) await api.delete('/devices', { token: t });
  } catch {
    /* bỏ qua */
  }
  currentToken = null;
}

/** Nhận push khi app đang mở (Android/iOS không tự hiện banner lúc này) */
export function listenForeground(cb: (d: PushData) => void): () => void {
  try {
    return onMessage(getMessaging(), (m) => cb(toData(m)));
  } catch {
    return () => undefined;
  }
}

/** Người dùng bấm vào thông báo (app ở nền hoặc đã tắt) */
export function listenOpened(cb: (d: PushData) => void): () => void {
  try {
    const messaging = getMessaging();
    getInitialNotification(messaging)
      .then((m) => m && cb(toData(m)))
      .catch(() => undefined);
    return onNotificationOpenedApp(messaging, (m) => cb(toData(m)));
  } catch {
    return () => undefined;
  }
}
