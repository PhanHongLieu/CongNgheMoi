# Microservices Architecture - MDP

## Services and Boundaries

- Auth Service
  - Login, logout, refresh token (No CAPTCHA required)
  - JWT issue/verify contract
  - Role update (ADMIN)
- User Service
  - Employee profile CRUD
  - Face template storage
  - Employment contracts management
  - Employee qualifications & certifications
  - Training records
  - Performance reviews
  - Benefits management
  - Disciplinary records
- Project Service
  - Project CRUD
  - Employee assignment to project
  - Subcontractor management
  - Safety inspections
  - Safety incidents reporting
- Attendance Service
  - Check-in/check-out workflow
  - GPS validation (< 100m)
  - Face verification (MVP comparator)
- Salary Service
  - Salary calculation & management
  - Overtime tracking
- Leave Service
  - Leave request management
  - Leave balance tracking
- Overtime Service
  - Overtime request management
  - Overtime approval workflow
- Notification Service
  - Create/read notifications
- System Service
  - System settings management
  - Audit logs
- API Gateway
  - Single entrypoint for frontend/mobile clients

## Data Ownership

- `users`, `refresh_tokens`, `accounts`: Auth/User
- `employment_contracts`, `employee_qualifications`, `training_records`, `performance_reviews`, `benefits`, `disciplinary_records`: User Service
- `projects`, `project_assignments`, `subcontractors`, `subcontractor_assignments`, `safety_inspections`, `safety_incidents`: Project Service
- `attendance_logs`: Attendance Service
- `salaries`, `salary_details`: Salary Service
- `leave_requests`: Leave Service
- `overtime_requests`: Overtime Service
- `notifications`: Notification Service
- `system_settings`, `audit_logs`: System Service

## Security Model

- Access token TTL: 1h
- Refresh token TTL: 7d
- RBAC roles: `SUPER_ADMIN`, `ADMIN`, `HR_MANAGER`, `PROJECT_MANAGER`, `EMPLOYEE`
- Password hash: `bcrypt`
- Transport security: HTTPS required in production
- No CAPTCHA for login (removed for better UX)

## Attendance Validation Rules

- Employee must be assigned to selected project
- Distance from project center must be less than configured radius (`GPS_RADIUS_METERS`, default 100m)
- Face score threshold: 0.75 (MVP)
- Reject duplicate check-in when open shift exists

## Role-Based Access Control

### SUPER_ADMIN
- Full system access
- Manage all accounts and roles
- System configuration
- Audit log access

### ADMIN
- User management (CRUD)
- Role assignment (except SUPER_ADMIN)
- System settings
- Audit log access

### HR_MANAGER
- Employee profile management
- Employment contracts
- Qualifications & training
- Performance reviews
- Benefits & disciplinary records
- Salary management
- Leave & overtime approval
- Attendance monitoring

### PROJECT_MANAGER
- Project CRUD
- Employee project assignments
- Subcontractor management
- Safety inspections & incidents
- Project progress tracking
- Resource allocation
- Cost management

### EMPLOYEE
- View own profile
- Face enrollment
- Check-in/check-out with face + GPS
- View own salary
- Submit leave requests
- Submit overtime requests
- View work schedule
- Receive notifications

## Production Recommendations (AWS)

- ECR for container images
- ECS Fargate service per microservice
- ALB in front of gateway
- RDS PostgreSQL Multi-AZ
- Secrets Manager for JWT and DB credentials
- CloudWatch Logs + Alarms
- AWS Backup for RDS snapshots
