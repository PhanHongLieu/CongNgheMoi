CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  employee_cođể VARCHAR(50) UNIQUE,
  full_name VARCHAR(255) NOT NULL,
  phone VARCHAR(30),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('ADMIN', 'MANAGER', 'EMPLOYEE')),
  position VARCHAR(100),
  department VARCHAR(100),
  face_template TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  project_cođể VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  address TEXT,
  latituđể DOUBLE PRECISION NOT NULL,
  longituđể DOUBLE PRECISION NOT NULL,
  start_date DATE,
  end_date DATE,
  status VARCHAR(30) NOT NULL DEFAULT 'PLANNING',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_assignments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  assignment_role VARCHAR(100),
  work_start TIMESTAMP,
  work_end TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, project_id)
);

CREATE TABLE IF NOT EXISTS attendance_logs (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  check_in_time TIMESTAMP,
  check_out_time TIMESTAMP,
  check_in_latituđể DOUBLE PRECISION,
  check_in_longituđể DOUBLE PRECISION,
  check_out_latituđể DOUBLE PRECISION,
  check_out_longituđể DOUBLE PRECISION,
  face_score DOUBLE PRECISION,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS notifications (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'UNREAD',
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS data_logs (
  id SERIAL PRIMARY KEY,
  service_name VARCHAR(100) NOT NULL,
  action VARCHAR(100) NOT NULL,
  collection VARCHAR(100),
  record_id VARCHAR(100),
  username VARCHAR(255),
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_progress_updates (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  progress_percent INTEGER NOT NULL CHECK (progress_percent BETWEEN 0 AND 100),
  note TEXT,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS employee_locations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  latituđể DOUBLE PRECISION NOT NULL,
  longituđể DOUBLE PRECISION NOT NULL,
  source VARCHAR(30) NOT NULL DEFAULT 'GPS',
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO users (
  employee_code,
  full_name,
  phone,
  email,
  password_hash,
  role,
  position,
  department
)
VALUES
(
  'ADMIN-001',
  'System Admin',
  '0900000000',
  'admin@mdp.local',
  '$2a$10$T./B9G0J/z.Ticy/7HJ9DuCtVbfpI7Kf8Y2xLzCfabu1r4MMic6OC',
  'ADMIN',
  'Quản lý hệ thống',
  'IT'
),
(
  'MNG-001',
  'Project Manager',
  '0900000001',
  'manager@mdp.local',
  '$2a$10$BfR9b1ObSlhcIHolEtReRu1qbsz/NtolgLDlPM3vN11/K003epmv6',
  'MANAGER',
  'Quản lý công trình',
  'Construction'
),
(
  'WRK-001',
  'Field Worker',
  '0900000002',
  'worker@mdp.local',
  '$2a$10$ofuomNtMJ2zLeRsbSg4RyuDsALDled063dhLK0NCacSXXdJvsdhyC',
  'EMPLOYEE',
  'Cong nhan',
  'Construction'
)
ON CONFLICT (email) DO UPDATE
SET
  full_name = EXCLUDED.full_name,
  phone = EXCLUDED.phone,
  password_hash = EXCLUDED.password_hash,
  role = EXCLUDED.role,
  position = EXCLUDED.position,
  department = EXCLUDED.department,
  updated_at = NOW();

INSERT INTO projects (
  project_code,
  name,
  address,
  latitude,
  longitude,
  start_date,
  end_date,
  status
)
VALUES (
  'PRJ-001',
  'Công trình Trung tam Logistics',
  'Khu cong nghiep Song Than, Binh Duong',
  10.9804,
  106.6519,
  CURRENT_DATE,
  CURRENT_DATE + INTERVAL '90 days',
  'IN_PROGRESS'
)
ON CONFLICT (project_code) DO NOTHING;

INSERT INTO project_assignments (
  user_id,
  project_id,
  assignment_role,
  work_start,
  work_end
)
SELECT
  worker.id,
  project.id,
  'Cong nhan thi cong',
  NOW(),
  NOW() + INTERVAL '90 days'
FROM users worker
JOIN projects project ON project.project_cođể = 'PRJ-001'
WHERE worker.email = 'worker@mdp.local'
ON CONFLICT (user_id, project_id) DO NOTHING;
