# MDP HRM + Construction Management Microservices

Hệ thống quản lý nhân sự và công trình cho Cong ty TNHH Thương mại Minh Dung Phat, tich hop chấm công khuôn mặt + GPS.

## Architecture Overview

- API Gateway: diem vao duy nhat cho frontend/client.
- Auth Service: dang nhap, JWT, refresh token, RBAC.
- User Service: CRUD nhân viên, luu metadata khuôn mặt.
- Project Service: CRUD công trình, phân công nhân viên.
- Attendance Service: check-in/check-out với anh khuôn mặt + GPS + khoang cach.
- Notification Service: tạo và truy vấn thông báo.
- PostgreSQL: co so dữ liệu trung tam với schema tach theo nghiep vu.

## Tech Stack

- Backend: Node.js, Express, REST API, JWT
- Frontend: React, Tailwind CSS
- DB: PostgreSQL
- Camera/GPS: MediaDevices API + Geolocation API
- Infra: Docker, AWS-ready deployment

## Quick Start

1. Sao chep env:

```bash
cp .env.example .env
```

2. Chay docker compose:

```bash
docker compose up --build
```

3. Truy cap:

- Frontend: http://localhost:5173
- API Gateway: http://localhost:8080

4. Cai model cho `face-api.js`:

- Dat cac file model vao thu muc `frontend/public/models`.
- Danh sach file can co: xem `frontend/public/models/README.md`.

## Docker Logs

- Xem log tat ca service:

```bash
docker compose logs -f
```

- Xem log mot service:

```bash
docker compose logs -f attendance-service
```

- Hệ thống đã cấu hình Docker logging driver `json-file` và log rotation qua biến môi trường:
   - `DOCKER_LOG_MAX_SIZE` (mac dinh `10m`)
   - `DOCKER_LOG_MAX_FILE` (mac dinh `5`)

## Core API via Gateway

- `POST /api/auth/login`
- `POST /api/auth/refresh`
- `GET /api/users`
- `POST /api/users`
- `GET /api/projects`
- `POST /api/projects`
- `POST /api/projects/assignments`
- `POST /api/attendance/check-in`
- `POST /api/attendance/check-out`
- `GET /api/attendance/history`
- `POST /api/notifications`

## Attendance Validation Flow

1. Employee mở trang chấm công tren frontend.
2. Frontend mo camera bảng `MediaDevices.getUserMedia` và chup frame.
3. Frontend lay vị trí bảng `navigator.geolocation.getCurrentPosition`.
4. Gui anh + GPS + projectId toi Attendance Service.
5. Attendance Service:
   - Xac thuc JWT role Employee/Manager/Admin
   - Kiểm tra assignment nhân viên thuoc công trình
   - So sánh GPS với tọa độ công trình bảng Haversine
   - Tu choi neu khoang cach >= 100m
   - So khop khuôn mặt bang embedding 128D (cosine similarity) + liveness head-turn
   - Luu bản ghi check-in/check-out

## AWS Deployment Suggestion

- ECS Fargate cho tung service (independent scaling)
- RDS PostgreSQL (Multi-AZ)
- Application Load Balancer trước API Gateway
- ECR cho contảiner image
- CloudWatch logs + alarms
- AWS Backup snapshot RDS dinh ky

## Security Notes

- JWT Access + Refresh token
- Password hashing bcrypt
- Helmet + CORS + input validation
- RBAC middleware tải mỗi service
- Bat buoc HTTPS tren production

