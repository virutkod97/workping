/* WorkPing service worker — nhận thông báo đẩy (Web Push) và mở đúng trang khi bấm vào thông báo. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let d = {};
  try {
    d = event.data ? event.data.json() : {};
  } catch {
    d = { title: 'WorkPing', body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    (async () => {
      // iOS bắt buộc mỗi push phải hiện thông báo, nếu không sẽ bị thu hồi quyền
      await self.registration.showNotification(d.title || 'WorkPing', {
        body: d.body || '',
        icon: '/icons/icon-192.png',
        badge: '/icons/badge-96.png',
        tag: d.tag || undefined,
        renotify: !!d.tag,
        data: { url: d.url || '/notifications' },
      });
      // Số trên biểu tượng ứng dụng = số thông báo chưa đọc
      if (typeof d.badge === 'number' && self.navigator.setAppBadge) {
        try {
          if (d.badge > 0) await self.navigator.setAppBadge(d.badge);
          else await self.navigator.clearAppBadge();
        } catch {
          /* không hỗ trợ */
        }
      }
      // Báo cho các cửa sổ đang mở làm mới dữ liệu
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      wins.forEach((c) => c.postMessage({ type: 'push', payload: d }));
    })(),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const win = wins.find((c) => c.url.startsWith(self.location.origin));
      if (win) {
        await win.focus();
        // Để ứng dụng tự điều hướng (giữ trạng thái đăng nhập, không tải lại trang)
        win.postMessage({ type: 'navigate', url });
        return;
      }
      await self.clients.openWindow(url);
    })(),
  );
});

// Trình duyệt tự đổi đăng ký push (hết hạn / xoay khoá) → tạo đăng ký mới và báo máy chủ,
// nếu không máy chủ vẫn gửi vào địa chỉ cũ và thiết bị im lặng mất thông báo
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      const old = event.oldSubscription;
      let sub = event.newSubscription;
      const key = old && old.options && old.options.applicationServerKey;
      if (!sub && key) sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      if (!old || !sub) return;
      const b64 = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      await fetch('/api/push-public/resubscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldEndpoint: old.endpoint, subscription: sub.toJSON(), appServerKey: key ? b64(key) : null }),
      });
    })().catch(() => undefined),
  );
});
