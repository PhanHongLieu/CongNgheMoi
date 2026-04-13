CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  employee_code VARCHAR(8) UNIQUE NOT NULL,
  first_name VARCHAR(120),
  last_name VARCHAR(120),
  full_name VARCHAR(255) NOT NULL,
  phone VARCHAR(30),
  email VARCHAR(255) UNIQUE NOT NULL,
  gender VARCHAR(20),
  status VARCHAR(20) NOT NULL DEFAULT 'WORKING' CHECK (status IN ('WORKING', 'RESIGNED')),
  birth_date DATE,
  address TEXT,
  profile_image_url TEXT,
  face_template TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(120);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(120);
ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'WORKING';
UPDATE users SET status = 'WORKING' WHERE status IS NULL OR TRIM(status) = '';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
ALTER TABLE users ADD CONSTRAINT users_status_check CHECK (status IN ('WORKING', 'RESIGNED'));

UPDATE users
SET
  first_name = COALESCE(
    NULLIF(TRIM(first_name), ''),
    CASE
      WHEN TRIM(full_name) ~ '[[:space:]]+' THEN NULLIF(substring(TRIM(full_name) FROM '([^[:space:]]+)$'), '')
      ELSE NULLIF(TRIM(full_name), '')
    END,
    NULL
  ),
  last_name = COALESCE(
    NULLIF(TRIM(last_name), ''),
    CASE
      WHEN TRIM(full_name) ~ '[[:space:]]+' THEN NULLIF(TRIM(regexp_replace(TRIM(full_name), '[[:space:]]+[^[:space:]]+$', '')), '')
      ELSE NULLIF(TRIM(full_name), '')
    END
  )
WHERE
  (first_name IS NULL OR TRIM(first_name) = '' OR last_name IS NULL OR TRIM(last_name) = '')
  AND full_name IS NOT NULL
  AND TRIM(full_name) <> '';
UPDATE users
SET full_name = COALESCE(NULLIF(TRIM(CONCAT_WS(' ', last_name, first_name)), ''), full_name)
WHERE full_name IS NULL OR TRIM(full_name) = '' OR full_name <> TRIM(CONCAT_WS(' ', last_name, first_name));

-- Convert old employee_code formats (USR-xxx, ADMIN-xxx, MNG-xxx etc.) to 8-digit numeric format
WITH existing AS (
  SELECT COALESCE(MAX(employee_code::INT), 0) AS max_code
  FROM users
  WHERE employee_code ~ '^[0-9]{8}$'
),
ordered AS (
  SELECT id, ROW_NUMBER() OVER (ORDER BY id) AS rn
  FROM users
  WHERE employee_code !~ '^[0-9]{8}$'
)
UPDATE users
SET employee_code = LPAD((existing.max_code + ordered.rn)::text, 8, '0')
FROM existing, ordered
WHERE users.id = ordered.id;

ALTER TABLE users DROP COLUMN IF EXISTS legacy_employee_code;

UPDATE users
SET employee_code = LPAD(id::text, 8, '0')
WHERE employee_code IS NULL OR employee_code !~ '^[0-9]{8}$';

ALTER TABLE users ALTER COLUMN employee_code TYPE VARCHAR(8);
ALTER TABLE users ALTER COLUMN employee_code SET NOT NULL;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_employee_code_format_chk;
ALTER TABLE users
ADD CONSTRAINT users_employee_code_format_chk CHECK (employee_code ~ '^[0-9]{8}$');

CREATE SEQUENCE IF NOT EXISTS users_employee_code_seq;

DO $$
DECLARE
  max_code INTEGER;
BEGIN
  SELECT COALESCE(MAX(employee_code::INTEGER), 0)
  INTO max_code
  FROM users
  WHERE employee_code ~ '^[0-9]{8}$';

  IF max_code < 1 THEN
    PERFORM setval('users_employee_code_seq', 1, false);
  ELSE
    PERFORM setval('users_employee_code_seq', max_code, true);
  END IF;
END $$;

ALTER TABLE users
ALTER COLUMN employee_code SET DEFAULT LPAD(nextval('users_employee_code_seq')::text, 8, '0');

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'password_hash'
  ) THEN
    EXECUTE 'ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'role'
  ) THEN
    EXECUTE 'ALTER TABLE users ALTER COLUMN role DROP NOT NULL';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'birth_year'
  ) THEN
    EXECUTE $sql$
      UPDATE users
      SET birth_date = COALESCE(
        birth_date,
        CASE
          WHEN birth_year IS NOT NULL THEN make_date(birth_year, 1, 1)
          ELSE NULL
        END
      )
      WHERE birth_date IS NULL
    $sql$;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS accounts (
  id SERIAL PRIMARY KEY,
  user_id INTEGER UNIQUE NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) NOT NULL CHECK (role IN ('SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'PROJECT_MANAGER', 'EMPLOYEE')),
  password_hash TEXT NOT NULL,
  account_status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (account_status IN ('ACTIVE', 'INACTIVE', 'LOCKED')),
  failed_login_attempts INTEGER NOT NULL DEFAULT 0,
  locked_until TIMESTAMP,
  last_login_at TIMESTAMP,
  password_changed_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS failed_login_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS locked_until TIMESTAMP;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_login_at TIMESTAMP;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS password_changed_at TIMESTAMP DEFAULT NOW();
ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_role_check;
ALTER TABLE accounts
ADD CONSTRAINT accounts_role_check CHECK (role IN ('SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'PROJECT_MANAGER', 'EMPLOYEE'));

CREATE UNIQUE INDEX IF NOT EXISTS accounts_single_super_admin_idx
ON accounts ((role))
WHERE role = 'SUPER_ADMIN';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'users'
      AND column_name = 'password_hash'
  ) THEN
    EXECUTE $sql$
      INSERT INTO accounts (
        user_id,
        role,
        password_hash,
        account_status,
        failed_login_attempts,
        locked_until,
        last_login_at,
        password_changed_at,
        created_at,
        updated_at
      )
      SELECT
        u.id,
        COALESCE(
          CASE
            WHEN u.role = 'SYSADMIN' THEN 'SUPER_ADMIN'
            WHEN u.role = 'MANAGER' THEN 'PROJECT_MANAGER'
            ELSE u.role
          END,
          'EMPLOYEE'
        ),
        u.password_hash,
        COALESCE(u.account_status, 'ACTIVE'),
        COALESCE(u.failed_login_attempts, 0),
        u.locked_until,
        u.last_login_at,
        COALESCE(u.password_changed_at, u.created_at, NOW()),
        COALESCE(u.created_at, NOW()),
        COALESCE(u.updated_at, NOW())
      FROM users u
      WHERE u.password_hash IS NOT NULL
      ON CONFLICT (user_id) DO UPDATE
      SET
        role = EXCLUDED.role,
        password_hash = EXCLUDED.password_hash,
        account_status = EXCLUDED.account_status,
        failed_login_attempts = EXCLUDED.failed_login_attempts,
        locked_until = EXCLUDED.locked_until,
        last_login_at = EXCLUDED.last_login_at,
        password_changed_at = EXCLUDED.password_changed_at,
        updated_at = NOW()
    $sql$;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS projects (
  id SERIAL PRIMARY KEY,
  project_code VARCHAR(50) UNIQUE NOT NULL,
  name VARCHAR(255) NOT NULL,
  address TEXT,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
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
  check_in_latitude DOUBLE PRECISION,
  check_in_longitude DOUBLE PRECISION,
  check_out_latitude DOUBLE PRECISION,
  check_out_longitude DOUBLE PRECISION,
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

CREATE TABLE IF NOT EXISTS salaries (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year INTEGER NOT NULL,
  base_salary DECIMAL(10,2) NOT NULL,
  overtime_hours DECIMAL(5,2) DEFAULT 0,
  overtime_rate DECIMAL(10,2) DEFAULT 0,
  bonus DECIMAL(10,2) DEFAULT 0,
  deductions DECIMAL(10,2) DEFAULT 0,
  total_salary DECIMAL(10,2) NOT NULL,
  payment_date DATE,
  status VARCHAR(20) DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'PAID', 'CANCELLED')),
  notes TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, month, year)
);

CREATE TABLE IF NOT EXISTS project_progress_updates (
  id SERIAL PRIMARY KEY,
  project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
  progress_percent INTEGER NOT NULL CHECK (progress_percent BETWEEN 0 AND 100),
  note TEXT,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_plan_boq_items (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  item_type VARCHAR(20) NOT NULL DEFAULT 'PLAN' CHECK (item_type IN ('PLAN', 'BOQ')),
  item_name VARCHAR(255) NOT NULL,
  description TEXT,
  unit VARCHAR(40),
  quantity NUMERIC(14,2) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'PLANNED',
  planned_date DATE,
  actual_date DATE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_material_logs (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  material_name VARCHAR(255) NOT NULL,
  unit VARCHAR(40),
  planned_qty NUMERIC(14,2) NOT NULL DEFAULT 0,
  received_qty NUMERIC(14,2) NOT NULL DEFAULT 0,
  used_qty NUMERIC(14,2) NOT NULL DEFAULT 0,
  unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
  supplier VARCHAR(255),
  status VARCHAR(30) NOT NULL DEFAULT 'PLANNED',
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_resource_allocations (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  resource_type VARCHAR(20) NOT NULL CHECK (resource_type IN ('LABOR', 'EQUIPMENT')),
  resource_name VARCHAR(255) NOT NULL,
  quantity NUMERIC(14,2) NOT NULL DEFAULT 0,
  unit VARCHAR(40),
  hourly_rate NUMERIC(14,2) NOT NULL DEFAULT 0,
  working_hours NUMERIC(14,2) NOT NULL DEFAULT 0,
  status VARCHAR(30) NOT NULL DEFAULT 'PLANNED',
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_cost_entries (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category VARCHAR(120) NOT NULL,
  description TEXT,
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  incurred_on DATE,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_acceptance_records (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title VARCHAR(255) NOT NULL,
  phase VARCHAR(120),
  accepted_by VARCHAR(255),
  accepted_on DATE,
  status VARCHAR(30) NOT NULL DEFAULT 'PENDING',
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_stage_templates (
  id SERIAL PRIMARY KEY,
  stage_name VARCHAR(255) NOT NULL,
  default_order INTEGER NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_stages (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage_name VARCHAR(255) NOT NULL,
  stage_order INTEGER NOT NULL,
  created_from_template_id INTEGER REFERENCES project_stage_templates(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_stages_project_order
ON project_stages(project_id, stage_order);

INSERT INTO project_stage_templates (stage_name, default_order)
SELECT seed.stage_name, seed.default_order
FROM (
  VALUES
    ('Preparation', 1),
    ('Foundation Construction', 2),
    ('Structure Construction', 3),
    ('Finishing', 4),
    ('Acceptance', 5)
) AS seed(stage_name, default_order)
WHERE NOT EXISTS (SELECT 1 FROM project_stage_templates);

CREATE TABLE IF NOT EXISTS employee_locations (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  latitude DOUBLE PRECISION NOT NULL,
  longitude DOUBLE PRECISION NOT NULL,
  source VARCHAR(30) NOT NULL DEFAULT 'GPS',
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO users (
  first_name,
  last_name,
  full_name,
  phone,
  email,
  gender,
  birth_date,
  address
)
VALUES
(
  'System',
  'Admin',
  'System Admin',
  '0900000000',
  'admin@mdp.local',
  'Male',
  DATE '1990-01-01',
  'Ho Chi Minh City'
),
(
  'Project',
  'Manager',
  'Project Manager',
  '0900000001',
  'manager@mdp.local',
  'Male',
  DATE '1992-01-01',
  'Binh Duong'
),
(
  'Field',
  'Worker',
  'Field Worker',
  '0900000002',
  'worker@mdp.local',
  'Male',
  DATE '1998-01-01',
  'Binh Duong'
),
(
  'System',
  'Operator',
  'System Operator',
  '0900000003',
  'itadmin@mdp.local',
  'Male',
  DATE '1993-01-01',
  'Ho Chi Minh City'
)
ON CONFLICT (email) DO UPDATE
SET
  first_name = EXCLUDED.first_name,
  last_name = EXCLUDED.last_name,
  full_name = EXCLUDED.full_name,
  phone = EXCLUDED.phone,
  gender = EXCLUDED.gender,
  birth_date = EXCLUDED.birth_date,
  address = EXCLUDED.address,
  updated_at = NOW();

INSERT INTO accounts (
  user_id,
  role,
  password_hash,
  account_status,
  password_changed_at
)
SELECT
  u.id,
  seed.role,
  seed.password_hash,
  'ACTIVE',
  NOW()
FROM users u
JOIN (
  VALUES
    ('admin@mdp.local', 'SUPER_ADMIN', '$2a$10$T./B9G0J/z.Ticy/7HJ9DuCtVbfpI7Kf8Y2xLzCfabu1r4MMic6OC'),
    ('itadmin@mdp.local', 'ADMIN', '$2a$10$T./B9G0J/z.Ticy/7HJ9DuCtVbfpI7Kf8Y2xLzCfabu1r4MMic6OC'),
    ('manager@mdp.local', 'PROJECT_MANAGER', '$2a$10$BfR9b1ObSlhcIHolEtReRu1qbsz/NtolgLDlPM3vN11/K003epmv6'),
    ('worker@mdp.local', 'EMPLOYEE', '$2a$10$ofuomNtMJ2zLeRsbSg4RyuDsALDled063dhLK0NCacSXXdJvsdhyC')
) AS seed(email, role, password_hash)
  ON u.email = seed.email
ON CONFLICT (user_id) DO UPDATE
SET
  role = EXCLUDED.role,
  password_hash = EXCLUDED.password_hash,
  updated_at = NOW();

UPDATE accounts
SET role = CASE
  WHEN role = 'SYSADMIN' THEN 'SUPER_ADMIN'
  WHEN role = 'MANAGER' THEN 'PROJECT_MANAGER'
  ELSE role
END,
updated_at = NOW();

UPDATE accounts a
SET role = 'SUPER_ADMIN',
    updated_at = NOW()
FROM users u
WHERE a.user_id = u.id
  AND u.email = 'admin@mdp.local';

UPDATE accounts a
SET role = 'ADMIN',
    updated_at = NOW()
FROM users u
WHERE a.user_id = u.id
  AND u.email = 'itadmin@mdp.local';

DO $$
DECLARE
  super_id INTEGER;
  conflict_id INTEGER;
BEGIN
  SELECT id INTO super_id FROM users WHERE email = 'admin@mdp.local';
  SELECT id INTO conflict_id FROM users WHERE employee_code = '00000001' AND id <> super_id LIMIT 1;

  IF super_id IS NOT NULL THEN
    IF conflict_id IS NOT NULL THEN
      UPDATE users SET employee_code = '99999999' WHERE id = conflict_id;
    END IF;
    UPDATE users SET employee_code = '00000001' WHERE id = super_id;
    IF conflict_id IS NOT NULL THEN
      UPDATE users SET employee_code = '00000004' WHERE id = conflict_id;
    END IF;
  END IF;
END $$;

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
  'PRJ-GPS-TEST',
  'GPS Attendance Test Site',
  'Mock GPS test location',
  10.857453,
  106.667651,
  CURRENT_DATE,
  CURRENT_DATE + INTERVAL '30 days',
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
JOIN projects project ON project.project_code = 'PRJ-001'
WHERE worker.email = 'worker@mdp.local'
ON CONFLICT (user_id, project_id) DO NOTHING;

INSERT INTO project_assignments (
  user_id,
  project_id,
  assignment_role,
  work_start,
  work_end
)
SELECT
  u.id,
  project.id,
  'GPS Test Worker',
  NOW(),
  NOW() + INTERVAL '30 days'
FROM users u
JOIN accounts a ON a.user_id = u.id
JOIN projects project ON project.project_code = 'PRJ-GPS-TEST'
WHERE a.role = 'EMPLOYEE'
  AND COALESCE(u.status, 'WORKING') = 'WORKING'
ON CONFLICT (user_id, project_id) DO NOTHING;

INSERT INTO salaries (
  user_id,
  month,
  year,
  base_salary,
  overtime_hours,
  overtime_rate,
  bonus,
  deductions,
  total_salary,
  payment_date,
  status
)
SELECT
  worker.id,
  EXTRACT(MONTH FROM CURRENT_DATE),
  EXTRACT(YEAR FROM CURRENT_DATE),
  8000000.00,
  20.5,
  50000.00,
  500000.00,
  200000.00,
  8000000.00 + (20.5 * 50000.00) + 500000.00 - 200000.00,
  CURRENT_DATE + INTERVAL '30 days',
  'PENDING'
FROM users worker
WHERE worker.email = 'worker@mdp.local'
ON CONFLICT (user_id, month, year) DO NOTHING;

