# WorkPing – Quản lý tiến độ & nhắc việc

Phần mềm thay thế file Excel **“Công cụ Quản lý Tiến độ VT&CNTT”**, bổ sung:

- **Quản lý nhân sự** (hồ sơ, bộ phận, quản lý trực tiếp, tài khoản đăng nhập, sơ đồ phân cấp).
- **Giao việc 3 cấp**: Trưởng phòng → Phó phòng → Nhân viên.
- **Nhắc việc tự động** và **thông báo đẩy** tới điện thoại **Android & iOS** — dạng ứng dụng web (PWA) “Thêm vào Màn hình chính” từ Chrome/Safari, **không cần** tài khoản Apple/Google Developer hay Firebase.

```
backend/   API Node.js + TypeScript + PostgreSQL (Prisma), Web Push, lịch nhắc việc
web/       Ứng dụng web (React + Ant Design) — dùng trên máy tính và cài lên điện thoại (PWA)
```

## 1. Tương ứng với file Excel cũ

| Sheet Excel | Trong phần mềm |
|---|---|
| `DASHBOARD` | Trang **Tổng quan**: số công việc/mốc theo tình trạng, việc cần chú ý, thống kê theo nhân sự & nhóm |
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

Gửi thông báo đẩy (Web Push) tới các thiết bị đã bật + lưu vào hộp *Thông báo* trong app:

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

## 5. Ứng dụng trên điện thoại (PWA) & thông báo đẩy

Không cần tài khoản nhà phát triển: mỗi người mở trang web trên điện thoại rồi thêm vào màn hình chính — biểu tượng WorkPing chạy toàn màn hình như ứng dụng và nhận thông báo đẩy.

| | iPhone / iPad | Android |
|---|---|---|
| Yêu cầu | iOS/iPadOS **16.4+**, dùng **Safari** | **Chrome** (hoặc Edge, Samsung Internet) |
| Cài | Safari → nút **Chia sẻ** → **Thêm vào MH chính** | Chrome → menu **⋮** → **Thêm vào màn hình chính / Cài đặt ứng dụng** (hoặc nút *Cài ứng dụng* trong WorkPing) |
| Bật thông báo | **Mở từ biểu tượng** trên màn hình chính → đăng nhập → *Cài app & thông báo* → **Bật thông báo** → Cho phép | Đăng nhập → *Cài app & thông báo* → **Bật thông báo** → Cho phép |

Trong app có trang **Cài app & thông báo** tự nhận biết thiết bị và hướng dẫn từng bước, nút **Gửi thông báo thử**. Bấm vào thông báo sẽ mở đúng công việc; số thông báo chưa đọc hiện trên biểu tượng (nếu máy hỗ trợ).

Điều kiện phía máy chủ:

- **Bắt buộc HTTPS** với chứng chỉ hợp lệ (script cài đặt tự lấy Let's Encrypt khi có `--domain` + `--email`). Truy cập bằng `http://IP` sẽ không bật được thông báo.
- Máy chủ phải **ra được Internet** tới dịch vụ push của trình duyệt: `web.push.apple.com` (iPhone), `fcm.googleapis.com` (Chrome), `updates.push.services.mozilla.com` (Firefox) — cổng 443.
- Khoá VAPID tự sinh lần đầu và lưu trong CSDL; `VAPID_SUBJECT` là email quản trị (lấy từ `--email`).

## 6. Triển khai

**Khuyến nghị – chạy dạng service trên Ubuntu (1 lệnh):**

```bash
sudo bash deploy/install.sh --domain workping.congty.vn --email it@congty.vn
```

Hướng dẫn chi tiết từng bước, nâng cấp, sao lưu/khôi phục, xử lý sự cố: [`deploy/README.md`](deploy/README.md).

Cách khác – Docker: `cp .env.example .env` rồi `docker compose up -d --build` (tự đặt reverse proxy HTTPS phía trước).

## 7. API chính

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
| GET | `/api/push/public-key` | Khoá VAPID công khai |
| POST | `/api/push/subscribe`, `/api/push/unsubscribe`, `/api/push/test` | Bật / tắt / gửi thử thông báo đẩy trên thiết bị |
| GET | `/api/excel/export` | Xuất báo cáo Excel |
| POST | `/api/admin/run-reminders` | Chạy nhắc việc ngay |
