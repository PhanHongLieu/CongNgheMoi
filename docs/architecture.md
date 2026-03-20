# Microservices Architecture - MDP

## Services and Boundaries

- Auth Service
  - Login, logout, refresh token
  - JWT issue/verify contract
  - Role update (ADMIN)
- User Service
  - Employee profile CRUD
  - Face template storage
- Project Service
  - Project CRUD
  - Employee assignment to project
- Attendance Service
  - Check-in/check-out workflow
  - GPS validation (< 100m)
  - Face verification (MVP comparator)
- Notification Service
  - Create/read notifications
- API Gateway
  - Single entrypoint for frontend/mobile clients

## Data Ownership

- `users`, `refresh_tokens`: Auth/User
- `projects`, `project_assignments`: Project
- `attendance_logs`: Attendance
- `notifications`: Notification

## Security Model

- Access token TTL: 1h
- Refresh token TTL: 7d
- RBAC roles: `ADMIN`, `MANAGER`, `EMPLOYEE`
- Password hash: `bcrypt`
- Transport security: HTTPS required in production

## Attendance Validation Rules

- Employee must be assigned to selected project
- Distance from project center must be less than configured radius (`GPS_RADIUS_METERS`, default 100m)
- Face score threshold: 0.75 (MVP)
- Reject duplicate check-in when open shift exists

## Production Recommendations (AWS)

- ECR for container images
- ECS Fargate service per microservice
- ALB in front of gateway
- RDS PostgreSQL Multi-AZ
- Secrets Manager for JWT and DB credentials
- CloudWatch Logs + Alarms
- AWS Backup for RDS snapshots
