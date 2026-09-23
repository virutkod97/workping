import { getMessaging, setBackgroundMessageHandler } from '@react-native-firebase/messaging';

// Push có phần "notification" được hệ điều hành tự hiển thị khi app ở nền.
// Handler này bắt buộc khai báo sớm để Android không cảnh báo & để mở rộng về sau (vd cập nhật badge).
try {
  setBackgroundMessageHandler(getMessaging(), async () => undefined);
} catch {
  // Chạy trong môi trường không có native Firebase (vd Expo Go) — bỏ qua
}
