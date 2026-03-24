# API Matrix and Roles

## Auth Service

- `POST /auth/login` - Public
- `POST /auth/refresh` - Public with refresh token
- `POST /auth/logout` - Authenticated
- `GET /auth/accounts` - `ADMIN`
- `PUT /auth/accounts/:id/role` - `ADMIN`
- `PUT /auth/accounts/:id/status` - `ADMIN`
- `PUT /auth/accounts/:id/password` - `ADMIN`

## User Service

- `GET /users` - `ADMIN`, `MANAGER`
- `GET /users/:id` - self or privileged
- `POST /users` - `ADMIN`
- `PUT /users/:id` - `ADMIN`, `MANAGER`
- `DELETE /users/:id` - `ADMIN`
- `PUT /users/:id/face-template` - self, `ADMIN`, `MANAGER`

## Project Service

- `GET /projects` - Authenticated
- `POST /projects` - `ADMIN`, `MANAGER`
- `PUT /projects/:id` - `ADMIN`, `MANAGER`
- `DELETE /projects/:id` - `ADMIN`, `MANAGER`
- `GET /projects/:id/assignments` - Authenticated
- `POST /projects/assignments` - `ADMIN`, `MANAGER`
- `DELETE /projects/assignments/:id` - `ADMIN`, `MANAGER`

## Attendance Service

- `POST /attendance/check-in` - Authenticated
- `POST /attendance/check-out` - Authenticated
- `GET /attendance/history` - Authenticated (scope by role)

## Notification Service

- `POST /notifications` - Authenticated
- `GET /notifications` - Authenticated
- `PUT /notifications/:id/read` - Authenticated owner

## Gateway Mapping

- `/api/auth/*` -> Auth Service
- `/api/users/*` -> User Service
- `/api/projects/*` -> Project Service
- `/api/attendance/*` -> Attendance Service
- `/api/notifications/*` -> Notification Service
