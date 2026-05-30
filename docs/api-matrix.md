# API Matrix and Roles

## Auth Service

- `POST /auth/login` - Public (No CAPTCHA required)
- `POST /auth/refresh` - Public with refresh token
- `POST /auth/logout` - Authenticated
- `GET /auth/accounts` - `ADMIN`
- `PUT /auth/accounts/:id/role` - `ADMIN`
- `PUT /auth/accounts/:id/status` - `ADMIN`
- `PUT /auth/accounts/:id/password` - `ADMIN`

## User Service

- `GET /users` - `ADMIN`, `HR_MANAGER`, `PROJECT_MANAGER`
- `GET /users/:id` - self or privileged
- `POST /users` - `ADMIN`, `HR_MANAGER`
- `PUT /users/:id` - `ADMIN`, `HR_MANAGER`
- `DELETE /users/:id` - `ADMIN`
- `PUT /users/:id/face-template` - self, `ADMIN`, `HR_MANAGER`
- `GET /users/:id/contracts` - `ADMIN`, `HR_MANAGER`, self
- `POST /users/:id/contracts` - `ADMIN`, `HR_MANAGER`
- `GET /users/:id/qualifications` - `ADMIN`, `HR_MANAGER`, self
- `POST /users/:id/qualifications` - `ADMIN`, `HR_MANAGER`
- `GET /users/:id/training` - `ADMIN`, `HR_MANAGER`, self
- `POST /users/:id/training` - `ADMIN`, `HR_MANAGER`
- `GET /users/:id/performance` - `ADMIN`, `HR_MANAGER`, self
- `POST /users/:id/performance` - `ADMIN`, `HR_MANAGER`
- `GET /users/:id/benefits` - `ADMIN`, `HR_MANAGER`, self
- `POST /users/:id/benefits` - `ADMIN`, `HR_MANAGER`
- `GET /users/:id/disciplinary` - `ADMIN`, `HR_MANAGER`, self
- `POST /users/:id/disciplinary` - `ADMIN`, `HR_MANAGER`

## Project Service

- `GET /projects` - Authenticated
- `POST /projects` - `ADMIN`, `PROJECT_MANAGER`
- `PUT /projects/:id` - `ADMIN`, `PROJECT_MANAGER`
- `DELETE /projects/:id` - `ADMIN`, `PROJECT_MANAGER`
- `GET /projects/:id/assignments` - Authenticated
- `POST /projects/assignments` - `ADMIN`, `PROJECT_MANAGER`
- `DELETE /projects/assignments/:id` - `ADMIN`, `PROJECT_MANAGER`
- `GET /projects/:id/subcontractors` - `ADMIN`, `PROJECT_MANAGER`
- `POST /projects/:id/subcontractors` - `ADMIN`, `PROJECT_MANAGER`
- `GET /projects/:id/safety-inspections` - `ADMIN`, `PROJECT_MANAGER`
- `POST /projects/:id/safety-inspections` - `ADMIN`, `PROJECT_MANAGER`
- `GET /projects/:id/safety-incidents` - `ADMIN`, `PROJECT_MANAGER`
- `POST /projects/:id/safety-incidents` - `ADMIN`, `PROJECT_MANAGER`

## Attendance Service

- `POST /attendance/check-in` - Authenticated
- `POST /attendance/check-out` - Authenticated
- `GET /attendance/history` - Authenticated (scope by role)

## Salary Service

- `GET /salaries` - `ADMIN`, `HR_MANAGER`, self
- `POST /salaries` - `ADMIN`, `HR_MANAGER`
- `PUT /salaries/:id` - `ADMIN`, `HR_MANAGER`
- `GET /salaries/:id/details` - `ADMIN`, `HR_MANAGER`, self

## Leave Service

- `GET /leave-requests` - `ADMIN`, `HR_MANAGER`, self
- `POST /leave-requests` - `EMPLOYEE`
- `PUT /leave-requests/:id/approve` - `ADMIN`, `HR_MANAGER`

## Overtime Service

- `GET /overtime-requests` - `ADMIN`, `HR_MANAGER`, self
- `POST /overtime-requests` - `EMPLOYEE`
- `PUT /overtime-requests/:id/approve` - `ADMIN`, `HR_MANAGER`

## Notification Service

- `POST /notifications` - Authenticated
- `GET /notifications` - Authenticated
- `PUT /notifications/:id/read` - Authenticated owner

## System Service

- `GET /system/settings` - `ADMIN`
- `PUT /system/settings` - `ADMIN`
- `GET /system/audit-logs` - `ADMIN`

## Gateway Mapping

- `/api/auth/*` -> Auth Service
- `/api/users/*` -> User Service
- `/api/projects/*` -> Project Service
- `/api/attendance/*` -> Attendance Service
- `/api/salaries/*` -> Salary Service
- `/api/leave/*` -> Leave Service
- `/api/overtime/*` -> Overtime Service
- `/api/notifications/*` -> Notification Service
- `/api/system/*` -> System Service
