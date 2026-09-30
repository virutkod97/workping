## WorkPing 1.0.0 — phiên bản chính thức đầu tiên

Phần mềm nhắc việc và quản lý tiến độ, thay cho file Excel theo dõi công việc của phòng.

### Chức năng
- **Công việc & mốc:** chia mốc có trọng số; tiến độ = Σ(trọng số × %) / Σ trọng số; tự tính *Quá hạn / Sắp đến hạn* (mặc định ≤ 3 ngày) theo giờ Việt Nam.
- **Giao việc 3 cấp:** Trưởng phòng → Phó trưởng phòng (chủ trì) → Nhân viên.
  - *Giao bổ sung*: một mốc giao cho nhiều nhân viên. Mốc hoàn thành khi tất cả xong, hoặc khi người chủ trì đánh dấu xong.
  - Giao ra ngoài nhóm được, nhưng phải xác nhận; được ghi nhật ký và có báo cáo *Giao ngoài nhóm*.
- **Nhân sự:** cấp tự suy ra theo chức danh; sơ đồ nhóm; mật khẩu tạm ngẫu nhiên, lần đầu đăng nhập bắt buộc đổi.
- **Tổng quan:** số liệu công việc/mốc; *Công việc cần chú ý* xét cả hạn chung lẫn hạn từng mốc; thống kê theo nhân sự và theo nhóm.
- **Thông báo đẩy (Web Push)** tới iPhone/iPad (iOS 16.4+, thêm vào Màn hình chính), Android và máy tính (Chrome/Edge). Không cần tài khoản nhà phát triển.
  - Nội dung gồm tiêu đề, tên công việc, người giao, mốc và hạn.
  - Nhắc hạn hằng ngày và bản tin cho lãnh đạo.
  - Trang quản trị: xem thiết bị, gửi thử, kiểm tra kết nối, xoá thiết bị.
- **Xuất Excel** báo cáo tiến độ.

### Triển khai (Ubuntu 22.04 / 24.04, không Docker)
- Cài hoặc nâng cấp bằng 1 lệnh: `deploy/install.sh`, `deploy/update.sh`.
- HTTPS Let's Encrypt, chạy được trên cổng khác 443 (`--https-port`) hoặc dùng chứng chỉ có sẵn.
- Cảnh báo khi chứng chỉ sắp hết hạn.
- Tự chuyển truy cập bằng IP sang tên miền.
- Đồng bộ giờ qua HTTPS khi mạng chặn NTP.
- Sao lưu CSDL hằng ngày.

### Bảo mật
- Khoá tài khoản khi đăng nhập sai nhiều lần; không có mật khẩu mặc định chung.
- Đổi mật khẩu thì đăng xuất các thiết bị khác.
- Chặn SSRF qua thông báo đẩy; có CSP và các header bảo mật.
- API chỉ nghe trên 127.0.0.1, đi qua nginx.

### Cài mới
```bash
git clone -b main https://github.com/virutkod97/workping.git && cd workping
sudo bash deploy/install.sh --domain <tên-miền> --email <email> [--https-port 8888]
```

### Máy chủ đang chạy bản trước (nhánh cũ) → chuyển sang main
```bash
cd ~/workping && git fetch origin && git checkout main && sudo bash deploy/update.sh
```

Gói `workping-1.0.0.tar.gz` là mã nguồn của bản này (giải nén rồi chạy `deploy/install.sh`); `SHA256SUMS.txt` dùng để kiểm tra tính toàn vẹn.
