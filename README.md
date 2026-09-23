# WorkPing – Quản lý tiến độ & nhắc việc

Phần mềm thay thế file Excel **“Công cụ Quản lý Tiến độ VT&CNTT”**, bổ sung:

- **Quản lý nhân sự** (hồ sơ, bộ phận, quản lý trực tiếp, tài khoản đăng nhập, sơ đồ phân cấp).
- **Giao việc 3 cấp**: Trưởng phòng → Phó phòng → Nhân viên.
- **Nhắc việc tự động** và **thông báo đẩy (push) qua Firebase Cloud Messaging** tới app mobile **Android & iOS**.

```
backend/   API Node.js + TypeScript + PostgreSQL (Prisma), Firebase Admin, lịch nhắc việc
web/       Ứng dụng web (React + Ant Design) cho máy tính — thay các sheet Excel
mobile/    App điện thoại (Expo / React Native) — Android + iOS, nhận push FCM
```

## 1. Tương ứng với file Excel cũ

| Sheet Excel | Trong phần mềm |
|---|---|
| `DASHBOARD` | Trang **Tổng quan** (web + mobile): số công việc/mốc theo tình trạng, việc cần chú ý, thống kê theo nhân sự & nhóm |
| `CONG_VIEC` | **Công việc**: Mã CV (tự sinh CV001…), nhóm, đơn vị, người giao, người phụ trách chung, ưu tiên, ngày bắt đầu, hạn cuối, % tiến độ, tình trạng, số ngày còn, ghi chú |
| `MOC_CONG_VIEC` | **Mốc công việc** trong từng công việc: STT, nội dung, trọng số, hạn, người chịu trách nhiệm, trạng thái, % mốc, ngày hoàn thành, cảnh báo |
| `VIEC_CAN_XU_LY` | **Việc của tôi**: các mốc được giao cho mình, sắp xếp quá hạn → sắp đến hạn |
| `DANH_MUC` | **Nhân sự** + **Cấu hình** (nhóm công việc, bộ phận) |

File Excel đang dùng là căn cứ để thiết kế dữ liệu; phần mềm thay thế hoàn toàn file đó (nhập liệu trực tiếp trên web/app), không nhập file Excel vào.

Công thức giữ nguyên như Excel:

- **% tiến độ** = Σ(trọng số × % mốc) / Σ trọng số (mốc “Hoàn thành” = 100%).
- **Tình trạng công việc**: 100% → *Đã hoàn thành*; quá hạn cuối → *Quá hạn*; còn ≤ 3 ngày → *Sắp đến hạn*; 0% → *Chưa thực hiện*; còn lại *Đang thực hiện*.
- **Cảnh báo mốc**: *QUÁ HẠN* / *SẮP ĐẾN HẠN* (≤ 3 ngày) / *Theo kế hoạch* / *Hoàn thành*.
- Số ngày cảnh báo chỉnh bằng biến `WARN_DAYS`. Ngày tính theo giờ Việt Nam.

**Xuất báo cáo**: nút *Xuất Excel* tạo file cùng cấu trúc (DASHBOARD, CONG_VIEC, MOC_CONG_VIEC, VIEC_CAN_XU_LY, NHAN_SU), có tô màu cảnh báo.

## 2. Phân quyền giao việc 3 cấp

| Cấp | Xem | Giao việc cho | Quản lý công việc |
|---|---|---|---|
| **Quản trị / Trưởng phòng** | Toàn phòng | Bất kỳ ai (không bị giới hạn nhóm) | Mọi công việc; quản lý nhân sự, danh mục, nhập/xuất Excel |
| **Phó trưởng phòng** | Việc của mình, của nhóm mình và việc mình đã giao đi | Bản thân, nhân sự **trong nhóm**; nhân viên **nhóm khác** (có cảnh báo) | Việc được giao/đã giao hoặc của nhóm mình: sửa, chia mốc, giao mốc, **giao tiếp** |
| **Nhân viên** | Việc mình tham gia | Chỉ bản thân (tự tạo việc riêng) | Cập nhật tiến độ, ghi chú các mốc được giao; bình luận |

**Nhóm của Phó trưởng phòng** = các nhân sự có *Nhóm / quản lý trực tiếp* là Phó trưởng phòng đó (trang Nhân sự → Sơ đồ nhóm).

Luồng điển hình:

1. **Trưởng phòng** tạo công việc (vd theo văn bản đến) → giao **Phó trưởng phòng** phụ trách chung (hoặc giao mốc cho PTP).
2. **Phó trưởng phòng** nhận thông báo → *Việc của tôi* → nút **Giao tiếp** trên từng mốc để chuyển xuống nhân viên (kèm hạn và chỉ đạo), hoặc *Thêm mốc / giao việc* để chia nhỏ công việc.
3. **Nhân viên** nhận push → *Việc của tôi* → cập nhật trạng thái/%/ghi chú.
4. Người giao & người phụ trách nhận thông báo mỗi lần đổi trạng thái; khi mọi mốc xong, Trưởng phòng nhận “Hoàn thành công việc”.

**Giao việc ngoài nhóm**: trong ô chọn người, nhân sự ngoài nhóm có nhãn **Ngoài nhóm**. Nếu Phó trưởng phòng vẫn chọn, hệ thống hiện cảnh báo và hỏi lý do; xác nhận thì vẫn giao được, đồng thời:
- đánh dấu “Ngoài nhóm” trên mốc/công việc;
- ghi vào bảng `CrossGroupAssignment` (người giao, người nhận, nhóm của người nhận, công việc, mốc, lý do, thời điểm);
- báo cho Phó trưởng phòng đang quản lý nhân sự đó.

Menu **Giao ngoài nhóm** tổng hợp theo khoảng thời gian (số lần, số người theo từng PTP) và xuất Excel.

Mọi thao tác được ghi vào **lịch sử** của công việc; có thể **bình luận/chỉ đạo** ngay trong công việc.

## 3. Thông báo & nhắc việc

Gửi push (Firebase) + lưu vào hộp *Thông báo* trong app:

- Được giao việc / giao mốc, đổi người phụ trách, đổi hạn.
- Mốc đổi trạng thái, công việc hoàn thành, bình luận mới.
- **Nhắc tự động hằng ngày** (mặc định 8:00 thứ 2–7, biến `REMINDER_CRON`):
  - nhắc từng mốc khi còn **3, 1, 0 ngày** (biến `REMIND_DAYS`);
  - bản tin cá nhân: “Bạn có X việc QUÁ HẠN, Y việc sắp đến hạn”;
  - bản tin cho Trưởng phòng (toàn phòng) và Phó phòng (nhóm mình).
- Không gửi trùng trong cùng một ngày. Có nút “Gửi nhắc việc ngay” trên web.

## 4. Chạy thử trên máy (development)

Yêu cầu: Node.js 20+, PostgreSQL 14+.

```bash
# Backend
cd backend
cp .env.example .env          # sửa DATABASE_URL, JWT_SECRET...
npm install
npx prisma migrate deploy
npm run seed                  # tạo admin / admin@123 và danh mục mặc định
npm run dev                   # http://localhost:4000/api

# Web (terminal khác)
cd web
npm install
npm run dev                   # http://localhost:5173
```

Đăng nhập: `admin / admin@123` → vào **Nhân sự** tạo tài khoản Trưởng phòng, Phó trưởng phòng, nhân viên (chọn *Nhóm / quản lý trực tiếp*). Nhân sự đăng nhập bằng mã nhân sự viết thường (vd `ns001`), mật khẩu mặc định `123456`, lần đầu bắt buộc đổi.

Kiểm thử backend: `cd backend && npm test` (cần DB `workping_test`, xem `backend/vitest.config.mts`).

## 5. Cấu hình Firebase (push cho Android & iOS)

1. Tạo project tại <https://console.firebase.google.com>.
2. **Server**: *Project settings → Service accounts → Generate new private key* → lưu thành `backend/firebase-service-account.json` (hoặc đặt nội dung base64 vào `FIREBASE_SERVICE_ACCOUNT_BASE64`). Kiểm tra: `GET /api/health` trả `"push": true`.
3. **Android**: thêm app Android package `vn.com.npc.workping` → tải `google-services.json` → đặt vào `mobile/firebase/`.
4. **iOS**: thêm app iOS bundle `vn.com.npc.workping` → tải `GoogleService-Info.plist` → đặt vào `mobile/firebase/`. Tạo **APNs Auth Key (.p8)** trên Apple Developer và tải lên *Project settings → Cloud Messaging → Apple app configuration*.
5. Đổi `bundleIdentifier`/`package` trong `mobile/app.json` nếu dùng định danh khác (phải khớp với Firebase).

Các file khoá Firebase đã được `.gitignore`, **không commit**.

## 6. Triển khai

**Khuyến nghị – chạy dạng service trên Ubuntu (1 lệnh):**

```bash
sudo bash deploy/install.sh --domain workping.congty.vn --email it@congty.vn \
  --firebase ~/firebase-service-account.json
```

Hướng dẫn chi tiết từng bước, nâng cấp, sao lưu/khôi phục, xử lý sự cố: [`deploy/README.md`](deploy/README.md).

Cách khác – Docker: `cp .env.example .env`, đặt khoá Firebase vào `secrets/firebase-service-account.json`, rồi `docker compose up -d --build`.

## 7. App mobile

Xem [`mobile/README.md`](mobile/README.md): build Android (APK/AAB) & iOS bằng EAS hoặc Android Studio/Xcode.

## 8. API chính

| Phương thức | Đường dẫn | Mô tả |
|---|---|---|
| POST | `/api/auth/login` | Đăng nhập → JWT |
| GET/POST/PUT/DELETE | `/api/users` | Nhân sự (`/assignable`: người mình được giao việc, kèm `inGroup`) |
| GET/POST/PUT/DELETE | `/api/tasks` | Công việc (lọc `scope`, `state`, `ownerId`, `groupName`, `priority`, `q`) |
| POST | `/api/tasks/:id/milestones` | Thêm mốc / giao mốc |
| POST | `/api/milestones/:id/delegate` | Giao tiếp mốc xuống nhân viên |
| GET | `/api/reports/cross-group` (`/export`) | Báo cáo giao việc ngoài nhóm (lọc `from`, `to`, `assignerId`) |
| PUT/DELETE | `/api/milestones/:id` | Sửa / xoá mốc |
| PATCH | `/api/milestones/:id/progress` | Cập nhật tiến độ mốc (người thực hiện) |
| POST | `/api/tasks/:id/comments` | Bình luận |
| GET | `/api/dashboard`, `/api/dashboard/my-work` | Tổng quan, việc của tôi |
| GET/POST | `/api/notifications…` | Thông báo, đánh dấu đã đọc |
| POST/DELETE | `/api/devices` | Đăng ký / huỷ FCM token của thiết bị |
| GET | `/api/excel/export` | Xuất báo cáo Excel |
| POST | `/api/admin/run-reminders` | Chạy nhắc việc ngay |
