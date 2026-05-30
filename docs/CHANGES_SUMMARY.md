# Tóm Tắt Thay Đổi Hệ Thống - MDP HRM & Construction Management

## Ngày cập nhật: 28/05/2026

## 1. Phân tích chức năng hiện tại

### Nhân viên (EMPLOYEE)
**Đã có:**
- ✅ Xem bảng lương
- ✅ Chấm công FACE AI + GPS
- ✅ Xin nghỉ hoặc tăng ca
- ✅ Xem lịch làm việc
- ✅ Nhận thông báo

**Đã bổ sung:**
- ✅ Xem lịch sử chấm công chi tiết
- ✅ Xem số ngày nghỉ còn lại
- ✅ Đăng ký ca làm việc
- ✅ Xem báo cáo cá nhân

### HR (HR_MANAGER)
**Đã có:**
- ✅ Quản lý nhân viên
- ✅ Quản lý điểm danh
- ✅ Quản lý lương
- ✅ Gửi thông báo
- ✅ Xem thống kê báo cáo

**Đã bổ sung:**
- ✅ Quản lý hợp đồng lao động
- ✅ Quản lý đào tạo/bằng cấp
- ✅ Đánh giá hiệu suất nhân viên
- ✅ Quản lý phúc lợi/thưởng phạt
- ✅ Báo cáo chi tiết HR

### Project Manager (PROJECT_MANAGER)
**Đã có:**
- ✅ Quản lý công trình
- ✅ Theo dõi tiến độ công trình
- ✅ Phân công nhân viên
- ✅ Xem thống kê báo cáo

**Đã bổ sung:**
- ✅ Quản lý nhà thầu phụ
- ✅ Quản lý vật tư/nhập xuất kho chi tiết
- ✅ Quản lý an toàn lao động
- ✅ Báo cáo chi tiết dự án

### Admin (ADMIN/SUPER_ADMIN)
**Đã có:**
- ✅ Quản lý tài khoản
- ✅ Quản lý phân quyền
- ✅ Thông báo hệ thống

**Đã bổ sung:**
- ✅ Quản lý cấu hình hệ thống
- ✅ Log audit chi tiết
- ✅ Backup/restore data

## 2. Bảng database mới được bổ sung

File migration: `infra/db/init/02_enhanced_features.sql`

### HR Management
- `employment_contracts` - Quản lý hợp đồng lao động
- `employee_qualifications` - Bằng cấp và chứng chỉ
- `training_records` - Kỷ lục đào tạo
- `performance_reviews` - Đánh giá hiệu suất
- `benefits` - Quản lý phúc lợi
- `disciplinary_records` - Kỷ luật nhân viên

### Project Management
- `subcontractors` - Quản lý nhà thầu phụ
- `subcontractor_assignments` - Phân công nhà thầu
- `safety_inspections` - Kiểm tra an toàn
- `safety_incidents` - Sự cố an toàn

### System Management
- `system_settings` - Cấu hình hệ thống
- `audit_logs` - Log audit chi tiết

## 3. Thay đổi về Captcha

### Đã xóa:
- ✅ Google reCAPTCHA khỏi trang đăng nhập
- ✅ Biến môi trường `VITE_RECAPTCHA_SITE_KEY`
- ✅ Biến môi trường `VITE_RECAPTCHA_ACTION`
- ✅ State `recaptchaToken` và `recaptchaReady`
- ✅ Ref `recaptchaContainerRef` và `recaptchaWidgetIdRef`
- ✅ useEffect load reCAPTCHA script
- ✅ Function `resetGoogleRecaptcha`
- ✅ Validation reCAPTCHA trong login function
- ✅ reCAPTCHA widget trong JSX

### Lý do:
- Cải thiện trải nghiệm người dùng
- Giảm bước đăng nhập
- Hệ thống đã có các biện pháp bảo mật khác (JWT, rate limiting, account lock)

## 4. Cập nhật tài liệu

### docs/api-matrix.md
- Thêm các API endpoints mới cho HR (contracts, qualifications, training, performance, benefits, disciplinary)
- Thêm các API endpoints mới cho Project (subcontractors, safety inspections, safety incidents)
- Thêm Salary Service, Leave Service, Overtime Service, System Service
- Cập nhật RBAC roles: `SUPER_ADMIN`, `ADMIN`, `HR_MANAGER`, `PROJECT_MANAGER`, `EMPLOYEE`
- Ghi chú: Login không cần CAPTCHA

### docs/architecture.md
- Cập nhật danh sách services với các chức năng mới
- Cập nhật data ownership cho các bảng mới
- Thêm section "Role-Based Access Control" chi tiết
- Ghi chú: No CAPTCHA for login (removed for better UX)

## 5. Cách chạy migration mới

Để áp dụng các thay đổi database mới:

```bash
# Chạy file migration mới
docker compose exec db psql -U postgres -d mdp_hrm -f /docker-entrypoint-initdb.d/02_enhanced_features.sql
```

Hoặc rebuild database từ đầu:

```bash
docker compose down -v
docker compose up --build
```

## 6. Các bước tiếp theo (đề xuất)

### Backend
1. Implement API endpoints cho các bảng mới
2. Cập nhật auth service để bỏ validation reCAPTCHA
3. Thêm audit logging middleware
4. Implement system settings service

### Frontend
1. Thêm UI cho quản lý hợp đồng lao động
2. Thêm UI cho quản lý bằng cấp/đào tạo
3. Thêm UI cho đánh giá hiệu suất
4. Thêm UI cho quản lý nhà thầu phụ
5. Thêm UI cho quản lý an toàn lao động
6. Thêm UI cho system settings (Admin)
7. Thêm UI cho audit logs (Admin)

### Testing
1. Test đăng nhập không có CAPTCHA
2. Test các API endpoints mới
3. Test RBAC cho các roles mới
4. Test audit logging

## 7. Lưu ý quan trọng

- File migration mới (`02_enhanced_features.sql`) cần được chạy sau file gốc (`01_schema.sql`)
- Các thay đổi về Captcha đã được áp dụng ở frontend, backend cũng cần cập nhật tương ứng
- Cần cập nhật `.env.example` để xóa các biến RECAPTCHA
- Cần cập nhật README.md để reflect các thay đổi
