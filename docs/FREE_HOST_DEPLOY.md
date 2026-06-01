# Huong dan deploy bang host free

Huong nay phu hop khi khong dung VPS/cloud server rieng.

Kien truc free de lam do an:

- Frontend: Vercel free
- Backend: Render free Web Services
- Database: Supabase free Postgres
- MinIO: bo qua trong ban free, face enrollment se luu anh mau vao database o dang data URL rut gon

Luu y: host free co gioi han. Render free service co the sleep khi khong co request, lan truy cap dau co the cham. Supabase free co gioi han dung luong va co the pause neu khong su dung trong thoi gian dai.

## 1. Database Supabase

1. Vao Supabase.
2. Tao project moi.
3. Lay connection string PostgreSQL dang URI.
4. Chay import schema tu may local:

```cmd
type infra\db\init\01_schema.sql | docker run -i --rm postgres:16 psql "postgresql://postgres:<password>@<host>:5432/postgres"
```

Neu dung PowerShell:

```powershell
Get-Content infra\db\init\01_schema.sql | docker run -i --rm postgres:16 psql "postgresql://postgres:<password>@<host>:5432/postgres"
```

Neu import loi giua chung, reset public schema roi import lai:

```sql
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO postgres;
GRANT ALL ON SCHEMA public TO public;
```

## 2. Backend Render free

Tao moi service Render bang `New -> Web Service`.

Khong dung Blueprint. Tao tung service thu cong tu cung GitHub repo.

| Render service | Root Directory | Runtime | Dockerfile |
| --- | --- | --- | --- |
| `mdp-auth-service` | `services/auth-service` | Docker | `Dockerfile` |
| `mdp-user-service` | `services/user-service` | Docker | `Dockerfile` |
| `mdp-project-service` | `services/project-service` | Docker | `Dockerfile` |
| `mdp-attendance-service` | `services/attendance-service` | Docker | `Dockerfile` |
| `mdp-notification-service` | `services/notification-service` | Docker | `Dockerfile` |
| `mdp-request-service` | `services/request-service` | Docker | `Dockerfile` |
| `mdp-gateway` | `gateway` | Docker | `Dockerfile` |

Chon plan free cho tung service.

## 3. Bien moi truong chung cho backend

Them cac bien sau vao tat ca backend service:

```env
DATABASE_URL=<Supabase Postgres connection string>
DATABASE_SSL=true
JWT_ACCESS_SECRET=<chuoi-bi-mat-dai>
JWT_REFRESH_SECRET=<chuoi-bi-mat-dai-khac>
TOKEN_ISSUER=mdp-system
GPS_RADIUS_METERS=100
RECAPTCHA_SECRET_KEY=<secret-key-hoac-dummy>
RECAPTCHA_MODE=v2_checkbox
RECAPTCHA_ACTION=login
RECAPTCHA_EXPECTED_ACTION=login
RECAPTCHA_MIN_SCORE=0.5
MINIO_ENABLED=false
```

Render tu cap bien `PORT`, khong can tu set `PORT`.

## 4. Bien moi truong cho gateway

Sau khi 6 backend service co URL, them vao `mdp-gateway`:

```env
AUTH_SERVICE_URL=https://mdp-auth-service.onrender.com
USER_SERVICE_URL=https://mdp-user-service.onrender.com
PROJECT_SERVICE_URL=https://mdp-project-service.onrender.com
ATTENDANCE_SERVICE_URL=https://mdp-attendance-service.onrender.com
NOTIFICATION_SERVICE_URL=https://mdp-notification-service.onrender.com
REQUEST_SERVICE_URL=https://mdp-request-service.onrender.com
```

Thay dung URL that Render cap cho service cua ban.

## 5. Frontend Vercel free

1. Vao Vercel.
2. Import GitHub repo.
3. Set `Root Directory`:

```txt
frontend
```

4. Framework Preset: Vite.
5. Build Command:

```txt
npm run build
```

6. Output Directory:

```txt
dist
```

7. Them bien moi truong:

```env
VITE_API_BASE=https://mdp-gateway.onrender.com/api
VITE_RECAPTCHA_SITE_KEY=<site-key-hoac-dummy>
VITE_RECAPTCHA_ACTION=login
```

Sau khi set bien moi truong, redeploy frontend.

## 6. Thu tu deploy

1. Tao Supabase Postgres.
2. Import `infra/db/init/01_schema.sql`.
3. Deploy 6 backend service tren Render.
4. Deploy gateway tren Render.
5. Set `*_SERVICE_URL` cho gateway.
6. Deploy frontend tren Vercel.
7. Set `VITE_API_BASE` cho frontend.
8. Redeploy frontend.

## 7. Cac loi thuong gap

Neu frontend bao `Failed to fetch`:

- Kiem tra `VITE_API_BASE` co dung URL gateway va co `/api` phia sau khong.
- Kiem tra gateway service tren Render da deploy thanh cong chua.

Neu gateway tra HTML `Cannot GET /api/...`:

- Kiem tra `*_SERVICE_URL` cua gateway.
- Kiem tra backend service tuong ung co chay khong.

Neu backend loi database:

- Kiem tra `DATABASE_URL`.
- Kiem tra `DATABASE_SSL=true`.
- Kiem tra da import schema Supabase chua.

Neu face enrollment upload loi MinIO:

- Kiem tra cac backend co `MINIO_ENABLED=false`.
- Ban free khong dung MinIO nen user-service se tra data URL de luu kem face template.
