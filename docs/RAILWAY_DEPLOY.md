# Railway deployment guide

This project is a monorepo with one frontend, one gateway, six backend services, PostgreSQL, and optional MinIO object storage.

Railway does not run `docker-compose.yml` directly. Create one Railway service per deployable folder and set the service root directory.

## 1. Create project and PostgreSQL

1. Push this repository to GitHub.
2. Railway Dashboard -> New Project -> Deploy from GitHub repo.
3. Add a PostgreSQL database in the same Railway project.
4. In each backend service, set `DATABASE_URL` to reference the PostgreSQL `DATABASE_URL`.

Railway PostgreSQL exposes `DATABASE_URL`, `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, and `PGDATABASE`.

## 2. Create services

Create these Railway services from the same GitHub repo.

| Railway service name | Root directory | Config file path |
| --- | --- | --- |
| `mdp-frontend` | `frontend` | `/frontend/railway.toml` |
| `mdp-gateway` | `gateway` | `/gateway/railway.toml` |
| `mdp-auth-service` | `services/auth-service` | `/services/auth-service/railway.toml` |
| `mdp-user-service` | `services/user-service` | `/services/user-service/railway.toml` |
| `mdp-project-service` | `services/project-service` | `/services/project-service/railway.toml` |
| `mdp-attendance-service` | `services/attendance-service` | `/services/attendance-service/railway.toml` |
| `mdp-notification-service` | `services/notification-service` | `/services/notification-service/railway.toml` |
| `mdp-request-service` | `services/request-service` | `/services/request-service/railway.toml` |

For every backend and gateway service, set a fixed `PORT` so the gateway can call services over Railway private networking.

| Service | PORT |
| --- | --- |
| `mdp-gateway` | `8080` |
| `mdp-auth-service` | `3001` |
| `mdp-user-service` | `3002` |
| `mdp-project-service` | `3003` |
| `mdp-attendance-service` | `3004` |
| `mdp-notification-service` | `3005` |
| `mdp-request-service` | `3006` |

## 3. Shared backend variables

Set these variables on every backend service and the gateway:

```env
JWT_ACCESS_SECRET=<generate-a-long-random-secret>
JWT_REFRESH_SECRET=<generate-another-long-random-secret>
TOKEN_ISSUER=mdp-system
GPS_RADIUS_METERS=100
RECAPTCHA_SECRET_KEY=<your-secret-or-temporary-dummy-value>
RECAPTCHA_MODE=v2_checkbox
RECAPTCHA_ACTION=login
RECAPTCHA_EXPECTED_ACTION=login
RECAPTCHA_MIN_SCORE=0.5
```

Set this on every backend service except the frontend and gateway:

```env
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

Adjust `Postgres` if your Railway PostgreSQL service has a different name.

## 4. Gateway variables

Set these on `mdp-gateway`:

```env
AUTH_SERVICE_URL=http://mdp-auth-service.railway.internal:3001
USER_SERVICE_URL=http://mdp-user-service.railway.internal:3002
PROJECT_SERVICE_URL=http://mdp-project-service.railway.internal:3003
ATTENDANCE_SERVICE_URL=http://mdp-attendance-service.railway.internal:3004
NOTIFICATION_SERVICE_URL=http://mdp-notification-service.railway.internal:3005
REQUEST_SERVICE_URL=http://mdp-request-service.railway.internal:3006
```

Only expose a public domain for `mdp-gateway` and `mdp-frontend`. The internal services can stay private.

## 5. Frontend variables

After `mdp-gateway` has a public Railway domain, set these on `mdp-frontend`:

```env
VITE_API_BASE=https://<your-mdp-gateway-domain>/api
VITE_RECAPTCHA_SITE_KEY=<your-site-key-or-temporary-dummy-value>
VITE_RECAPTCHA_ACTION=login
```

Redeploy the frontend after setting `VITE_API_BASE`.

## 6. Optional MinIO service

Face sample uploads use MinIO. For a quick project demo you can deploy without MinIO first; user-service will still start, but face sample upload storage will not be complete.

If you need MinIO:

1. Add a Docker image service using `minio/minio:latest`.
2. Set start command:

```sh
server /data --address ":9000" --console-address ":9001"
```

3. Add a Railway volume mounted at `/data`.
4. Set variables:

```env
PORT=9000
MINIO_ROOT_USER=<minio-user>
MINIO_ROOT_PASSWORD=<minio-password>
```

5. Set these variables on `mdp-user-service`:

```env
MINIO_ENDPOINT=mdp-minio.railway.internal
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=<minio-user>
MINIO_SECRET_KEY=<minio-password>
MINIO_BUCKET=face-enrollments
```

## 7. Import database schema

After PostgreSQL is running, import:

```txt
infra/db/init/01_schema.sql
```

One Windows-friendly option is to use the local Docker PostgreSQL client:

```powershell
Get-Content infra\db\init\01_schema.sql | docker run -i --rm postgres:16 psql "<Railway Postgres public connection string>"
```

Use the Railway PostgreSQL public connection string or TCP proxy connection string for local import.

## 8. Deploy order

1. PostgreSQL
2. Backend services
3. Gateway
4. Frontend
5. MinIO, if needed
6. Import schema
7. Redeploy backend services if schema-dependent startup failed before import
