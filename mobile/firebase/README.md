# Cấu hình Firebase cho app mobile

Đặt 2 file tải từ Firebase Console vào thư mục này (đã được `.gitignore`, không commit):

| File | Lấy ở đâu |
|---|---|
| `google-services.json` | Firebase Console → Project settings → Your apps → Android app `vn.com.npc.workping` |
| `GoogleService-Info.plist` | Firebase Console → Project settings → Your apps → iOS app `vn.com.npc.workping` |

iOS còn cần: Firebase Console → Project settings → **Cloud Messaging** → *Apple app configuration* → tải lên **APNs Authentication Key (.p8)** lấy từ Apple Developer (Keys → Apple Push Notifications service).
