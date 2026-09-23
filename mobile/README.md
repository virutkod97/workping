# WorkPing – App mobile (Android & iOS)

Expo (React Native) + Expo Router + `@react-native-firebase/messaging` (FCM cho cả Android và iOS/APNs).

Chức năng: Tổng quan · Việc của tôi (quá hạn/sắp hạn) · Công việc · Giao việc & giao mốc (Trưởng/Phó phòng) · Cập nhật tiến độ · Bình luận · Hộp thông báo · Danh bạ nhân sự · Đổi mật khẩu. Bấm vào push sẽ mở đúng công việc; khi đang mở app, push hiện dạng banner trong app.

> App dùng module native (Firebase) nên **không chạy trên Expo Go** — cần bản *development build* hoặc bản build thật.

## Chuẩn bị

1. Đặt `google-services.json` và `GoogleService-Info.plist` vào `firebase/` (xem [`firebase/README.md`](firebase/README.md)).
2. Địa chỉ API mặc định: tạo `.env` từ `.env.example` (`EXPO_PUBLIC_API_URL=https://ten-mien/api`). Người dùng vẫn đổi được ở màn hình đăng nhập → *Cấu hình máy chủ*.
3. `npm install`

## Build bằng EAS (không cần Mac cho iOS)

```bash
npx eas-cli@latest login
npx eas-cli@latest build:configure
npx eas-cli@latest build --platform android --profile preview      # APK cài thử
npx eas-cli@latest build --platform ios                            # cần tài khoản Apple Developer
npx eas-cli@latest build --profile development --platform all      # bản dev
```

Khi build trên EAS, tải 2 file Firebase lên thành biến môi trường kiểu *file* (vì chúng không được commit):

```bash
npx eas-cli@latest env:create --name GOOGLE_SERVICES_JSON --type file --value ./firebase/google-services.json --visibility secret
npx eas-cli@latest env:create --name GOOGLE_SERVICE_INFO_PLIST --type file --value ./firebase/GoogleService-Info.plist --visibility secret
```

`app.config.js` sẽ tự dùng 2 biến này.

## Build trên máy

```bash
npx expo run:android      # cần Android Studio / SDK
npx expo run:ios          # cần macOS + Xcode (dùng thiết bị thật để nhận push)
npm start                 # Metro cho development build
```

## Kiểm tra push

Đăng nhập trên điện thoại → cho phép thông báo → tab *Cá nhân* → *Gửi thông báo thử*.
