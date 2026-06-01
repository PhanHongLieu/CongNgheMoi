# Huong dan deploy bang host free

Huong nay phu hop khi khong dung VPS/cloud server rieng.

Kien truc free de lam do an:

- Frontend: Vercel free
- Backend: Render free Web Services
- Database: Supabase free Postgres
- Object storage: MinIO tren Railway co volume neu can upload anh face enrollment
- AI Chatbox: Render free Web Service rieng, goi OpenAI API tu backend

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
| `mdp-ai-service` | `services/ai-service` | Docker | `Dockerfile` |
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

Quan trong: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, va `TOKEN_ISSUER` phai giong nhau tren tat ca backend service. Neu auth-service dung mot secret de cap token, nhung user-service/project-service/notification-service dung secret khac de verify token, frontend se dang nhap thanh cong roi bi day ve man hinh login ngay sau do.

Render tu cap bien `PORT`, khong can tu set `PORT`.

Rieng `mdp-ai-service`, them cac bien AI:

```env
AI_PROVIDER=openai
AI_MODEL=gpt-4o-mini
OPENAI_API_KEY=<OpenAI API key cua ban>
```

## 4. Bien moi truong cho gateway

Sau khi cac backend service co URL, them vao `mdp-gateway`:

```env
AUTH_SERVICE_URL=https://mdp-auth-service.onrender.com
USER_SERVICE_URL=https://mdp-user-service.onrender.com
PROJECT_SERVICE_URL=https://mdp-project-service.onrender.com
ATTENDANCE_SERVICE_URL=https://mdp-attendance-service.onrender.com
NOTIFICATION_SERVICE_URL=https://mdp-notification-service.onrender.com
REQUEST_SERVICE_URL=https://mdp-request-service.onrender.com
AI_SERVICE_URL=https://mdp-ai-service.onrender.com
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
3. Deploy cac backend service tren Render.
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

Neu login tra HTML `502 Bad Gateway` cua Render:

- Day khong phai loi form login. Day la loi service Render dang down, crash, sleep/boot qua lau, hoac gateway proxy toi backend dang loi.
- Mo truc tiep gateway health:

```txt
https://<gateway-render-url>/health
```

- Neu `/health` cung 502, vao Render service `mdp-gateway` -> Logs de xem gateway co crash khong.
- Neu `/health` OK, mo auth-service health:

```txt
https://<auth-service-render-url>/health
```

- Neu auth-service 502, vao Render service `mdp-auth-service` -> Logs. Thuong la thieu `DATABASE_URL`, sai `DATABASE_SSL=true`, chua import schema, hoac service deploy sai root directory.
- Neu ca gateway va auth-service `/health` deu OK, kiem tra bien tren frontend:

```env
VITE_API_BASE=https://<gateway-render-url>/api
```

- Kiem tra bien tren gateway:

```env
AUTH_SERVICE_URL=https://<auth-service-render-url>
USER_SERVICE_URL=https://<user-service-render-url>
PROJECT_SERVICE_URL=https://<project-service-render-url>
ATTENDANCE_SERVICE_URL=https://<attendance-service-render-url>
NOTIFICATION_SERVICE_URL=https://<notification-service-render-url>
REQUEST_SERVICE_URL=https://<request-service-render-url>
```

Neu login bao thanh cong roi tu dong out:

- Kiem tra `JWT_ACCESS_SECRET` tren tat ca backend service co giong nhau khong.
- Kiem tra `TOKEN_ISSUER` tren tat ca backend service deu la `mdp-system`.
- Sau khi sua env tren Render, redeploy tat ca backend service.
- Trinh tu toi thieu can redeploy: `mdp-auth-service`, `mdp-user-service`, `mdp-project-service`, `mdp-attendance-service`, `mdp-notification-service`, `mdp-request-service`, sau do `mdp-gateway`.

Neu backend loi database:

- Kiem tra `DATABASE_URL`.
- Kiem tra `DATABASE_SSL=true`.
- Kiem tra da import schema Supabase chua.

Neu face enrollment upload loi MinIO:

- Kiem tra cac backend co `MINIO_ENABLED=false`.
- Ban free khong dung MinIO nen user-service se tra data URL de luu kem face template.

## 8. Neu muon dung MinIO object storage that

MinIO can volume persistent de giu file sau moi lan redeploy/restart. Vi vay khong nen chay MinIO tren host free khong co volume. Neu container bi restart va khong co disk persistent, anh face enrollment se mat.

Co 2 huong kha thi:

### Huong A: MinIO tren Render co Persistent Disk

Luu y: Render persistent disk can paid service. Free web service khong phu hop de chay MinIO ben vung.

Tao service rieng tren Render:

```txt
Name: mdp-minio
Runtime: Docker image
Image: minio/minio:latest
Start Command: server /data --address ":$PORT" --console-address ":9001"
Disk Mount Path: /data
```

Environment cua MinIO:

```env
MINIO_ROOT_USER=<minio-user>
MINIO_ROOT_PASSWORD=<minio-password>
```

Sau khi `mdp-minio` co URL public, sua `mdp-user-service`:

```env
MINIO_ENABLED=true
MINIO_ENDPOINT=mdp-minio.onrender.com
MINIO_PORT=443
MINIO_USE_SSL=true
MINIO_ACCESS_KEY=<minio-user>
MINIO_SECRET_KEY=<minio-password>
MINIO_BUCKET=face-enrollments
MINIO_PUBLIC_BASE_URL=https://mdp-minio.onrender.com
```

Sau do redeploy `mdp-user-service`.

### Huong B: MinIO tren Railway co Volume

Railway ho tro persistent volume. Tao service MinIO tu Docker image:

```txt
Image: minio/minio:latest
Start Command: minio server /data --address ":9000" --console-address ":9001"
Volume Mount Path: /data
```

Environment cua MinIO:

```env
PORT=9000
MINIO_ROOT_USER=<minio-user>
MINIO_ROOT_PASSWORD=<minio-password>
```

Sua `mdp-user-service`:

```env
MINIO_ENABLED=true
MINIO_ENDPOINT=minio-production-a59e.up.railway.app
MINIO_PORT=443
MINIO_USE_SSL=true
MINIO_ACCESS_KEY=<MINIO_ROOT_USER>
MINIO_SECRET_KEY=<MINIO_ROOT_PASSWORD>
MINIO_BUCKET=face-enrollments
MINIO_PUBLIC_BASE_URL=https://minio-production-a59e.up.railway.app
```

Neu backend van o Render, phai dung public HTTPS domain cua MinIO nhu tren. Khong dung private host `minio.railway.internal` vi Render khong truy cap duoc mang noi bo Railway.

Luu y: `MINIO_ENDPOINT` chi ghi host, khong ghi `https://`.

### Huong C: Van giu host free

Neu bat buoc free, nen dung object storage S3-compatible co free tier nhu Cloudflare R2 thay vi tu host MinIO server. Khi do can cau hinh theo S3-compatible endpoint hoac chuyen code sang AWS S3 SDK. Day khong phai MinIO server, nhung cung la object storage.
