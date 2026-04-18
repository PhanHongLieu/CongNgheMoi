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
  hourly_rate NUMERIC(14,2) NOT NULL DEFAULT 35000,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

ALTER TABLE users ADD COLUMN IF NOT EXISTS first_name VARCHAR(120);
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_name VARCHAR(120);
ALTER TABLE users ADD COLUMN IF NOT EXISTS birth_date DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'WORKING';
ALTER TABLE users ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(14,2) NOT NULL DEFAULT 35000;
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

CREATE TABLE IF NOT EXISTS holidays (
  id SERIAL PRIMARY KEY,
  holiday_date DATE NOT NULL UNIQUE,
  holiday_name VARCHAR(255) NOT NULL,
  multiplier NUMERIC(6,2) NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_holidays_active_date
ON holidays (holiday_date)
WHERE is_active = TRUE;

CREATE INDEX IF NOT EXISTS idx_attendance_logs_user_project_time
ON attendance_logs (user_id, project_id, check_in_time, check_out_time);

CREATE INDEX IF NOT EXISTS idx_project_assignments_user_project_window
ON project_assignments (user_id, project_id, work_start, work_end);

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

-- Ensure extended project manager schema exists in bootstrap database
ALTER TABLE project_stages ADD COLUMN IF NOT EXISTS progress_percent INTEGER NOT NULL DEFAULT 0;
ALTER TABLE project_stages ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'NOT_STARTED';
ALTER TABLE project_stages ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE project_stages ADD COLUMN IF NOT EXISTS weight NUMERIC(8,2) NOT NULL DEFAULT 1;
ALTER TABLE project_stages ADD COLUMN IF NOT EXISTS started_at TIMESTAMP;
ALTER TABLE project_stages ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP;
ALTER TABLE project_stages ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE project_plan_boq_items ADD COLUMN IF NOT EXISTS stage_id INTEGER REFERENCES project_stages(id) ON DELETE SET NULL;
ALTER TABLE project_plan_boq_items ADD COLUMN IF NOT EXISTS wbs_code VARCHAR(80);
ALTER TABLE project_plan_boq_items ADD COLUMN IF NOT EXISTS parent_wbs_code VARCHAR(80);
ALTER TABLE project_plan_boq_items ADD COLUMN IF NOT EXISTS dependency_wbs_code VARCHAR(80);
ALTER TABLE project_plan_boq_items ADD COLUMN IF NOT EXISTS dependency_type VARCHAR(20);
ALTER TABLE project_plan_boq_items ADD COLUMN IF NOT EXISTS planned_end_date DATE;
ALTER TABLE project_plan_boq_items ADD COLUMN IF NOT EXISTS actual_end_date DATE;

CREATE TABLE IF NOT EXISTS project_budget_plans (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  planned_budget NUMERIC(14,2) NOT NULL DEFAULT 0,
  planned_disbursement NUMERIC(14,2) NOT NULL DEFAULT 0,
  planned_revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
  note TEXT,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_budget_vouchers (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  voucher_code VARCHAR(80),
  voucher_type VARCHAR(20) NOT NULL DEFAULT 'EXPENSE' CHECK (voucher_type IN ('INCOME', 'EXPENSE')),
  category VARCHAR(120),
  amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  voucher_date DATE,
  status VARCHAR(30) NOT NULL DEFAULT 'DRAFT',
  description TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_equipment_assets (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  license_plate VARCHAR(120) NOT NULL,
  equipment_type VARCHAR(120),
  brand VARCHAR(120),
  model VARCHAR(120),
  vin_no VARCHAR(120),
  engine_no VARCHAR(120),
  fuel_type VARCHAR(60),
  ownership_type VARCHAR(60) DEFAULT 'OWNED',
  driver_name VARCHAR(160),
  driver_code VARCHAR(80),
  driver_phone VARCHAR(50),
  rental_vendor VARCHAR(160),
  status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE',
  note TEXT,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_equipment_logs (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  equipment_id INTEGER NOT NULL REFERENCES project_equipment_assets(id) ON DELETE CASCADE,
  log_type VARCHAR(30) NOT NULL CHECK (log_type IN ('MOVEMENT', 'FUEL', 'MAINTENANCE', 'TRIP_SHIFT')),
  log_date DATE NOT NULL DEFAULT CURRENT_DATE,
  title VARCHAR(255),
  description TEXT,
  trip_count INTEGER,
  distance_km NUMERIC(12,2),
  fuel_liters NUMERIC(12,2),
  odometer_km NUMERIC(12,2),
  cost_amount NUMERIC(14,2),
  status VARCHAR(30),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_construction_diaries (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  diary_code VARCHAR(80),
  diary_date DATE NOT NULL DEFAULT CURRENT_DATE,
  title VARCHAR(255) NOT NULL,
  site_photo_data TEXT,
  work_content TEXT,
  issues TEXT,
  weather VARCHAR(120),
  weather_morning VARCHAR(80),
  weather_afternoon VARCHAR(80),
  weather_evening VARCHAR(80),
  weather_night VARCHAR(80),
  site_condition TEXT,
  temperature VARCHAR(40),
  incident_report TEXT,
  safety_rating VARCHAR(20),
  quality_rating VARCHAR(20),
  progress_rating VARCHAR(20),
  hygiene_rating VARCHAR(20),
  proposal TEXT,
  report_watchers TEXT,
  note TEXT,
  status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_rfx_records (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  rfx_type VARCHAR(20) NOT NULL DEFAULT 'RFI' CHECK (rfx_type IN ('SUBMITTAL', 'RFI', 'ISSUE')),
  title VARCHAR(255) NOT NULL,
  priority VARCHAR(20) NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('LOW', 'NORMAL', 'HIGH', 'CRITICAL')),
  status VARCHAR(30) NOT NULL DEFAULT 'OPEN',
  description TEXT,
  requested_by VARCHAR(255),
  due_date DATE,
  resolved_on DATE,
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS project_stage_assignments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  stage_id INTEGER NOT NULL REFERENCES project_stages(id) ON DELETE CASCADE,
  assignment_role VARCHAR(100),
  work_start TIMESTAMP,
  work_end TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, stage_id)
);

CREATE INDEX IF NOT EXISTS idx_project_stage_assignments_project_stage
ON project_stage_assignments(project_id, stage_id);

CREATE INDEX IF NOT EXISTS idx_project_equipment_assets_project
ON project_equipment_assets(project_id);

CREATE INDEX IF NOT EXISTS idx_project_equipment_logs_project_equipment
ON project_equipment_logs(project_id, equipment_id);

DO $$
DECLARE
  v_project_id INTEGER;
  v_manager_id INTEGER;
  v_worker_id INTEGER;
  v_stage_preparation_id INTEGER;
  v_stage_foundation_id INTEGER;
  v_stage_structure_id INTEGER;
  v_stage_finishing_id INTEGER;
  v_stage_acceptance_id INTEGER;
  v_excavator_id INTEGER;
  v_crane_id INTEGER;
BEGIN
  SELECT id INTO v_project_id FROM projects WHERE project_code = 'PRJ-001';
  SELECT id INTO v_manager_id FROM users WHERE email = 'manager@mdp.local';
  SELECT id INTO v_worker_id FROM users WHERE email = 'worker@mdp.local';

  IF v_project_id IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO project_assignments (user_id, project_id, assignment_role, work_start, work_end)
  SELECT v_manager_id, v_project_id, 'Chi huy truong', NOW() - INTERVAL '20 days', NOW() + INTERVAL '60 days'
  WHERE v_manager_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM project_assignments pa WHERE pa.user_id = v_manager_id AND pa.project_id = v_project_id
    );

  INSERT INTO project_stages
    (project_id, stage_name, stage_order, created_from_template_id, progress_percent, status, is_locked, weight, started_at, completed_at, updated_by)
  SELECT
    v_project_id,
    seed.stage_name,
    seed.stage_order,
    tmpl.id,
    seed.progress_percent,
    seed.status,
    seed.is_locked,
    seed.weight,
    seed.started_at,
    seed.completed_at,
    v_manager_id
  FROM (
    VALUES
      ('Preparation', 1, 100, 'COMPLETED', FALSE, 1::numeric, NOW() - INTERVAL '30 days', NOW() - INTERVAL '24 days'),
      ('Foundation Construction', 2, 65, 'IN_PROGRESS', FALSE, 1::numeric, NOW() - INTERVAL '23 days', NULL),
      ('Structure Construction', 3, 20, 'IN_PROGRESS', TRUE, 1::numeric, NOW() - INTERVAL '10 days', NULL),
      ('Finishing', 4, 0, 'NOT_STARTED', TRUE, 1::numeric, NULL, NULL),
      ('Acceptance', 5, 0, 'NOT_STARTED', TRUE, 1::numeric, NULL, NULL)
  ) AS seed(stage_name, stage_order, progress_percent, status, is_locked, weight, started_at, completed_at)
  LEFT JOIN project_stage_templates tmpl
    ON tmpl.stage_name = seed.stage_name
  WHERE NOT EXISTS (
    SELECT 1
    FROM project_stages ps
    WHERE ps.project_id = v_project_id
      AND ps.stage_name = seed.stage_name
  );

  SELECT id INTO v_stage_preparation_id FROM project_stages WHERE project_id = v_project_id AND stage_name = 'Preparation' ORDER BY id DESC LIMIT 1;
  SELECT id INTO v_stage_foundation_id FROM project_stages WHERE project_id = v_project_id AND stage_name = 'Foundation Construction' ORDER BY id DESC LIMIT 1;
  SELECT id INTO v_stage_structure_id FROM project_stages WHERE project_id = v_project_id AND stage_name = 'Structure Construction' ORDER BY id DESC LIMIT 1;
  SELECT id INTO v_stage_finishing_id FROM project_stages WHERE project_id = v_project_id AND stage_name = 'Finishing' ORDER BY id DESC LIMIT 1;
  SELECT id INTO v_stage_acceptance_id FROM project_stages WHERE project_id = v_project_id AND stage_name = 'Acceptance' ORDER BY id DESC LIMIT 1;

  IF v_manager_id IS NOT NULL THEN
    INSERT INTO project_stage_assignments (user_id, project_id, stage_id, assignment_role, work_start, work_end)
    SELECT v_manager_id, v_project_id, stage_id, 'Giam sat giai doan', NOW() - INTERVAL '25 days', NOW() + INTERVAL '40 days'
    FROM (
      VALUES
        (v_stage_preparation_id),
        (v_stage_foundation_id),
        (v_stage_structure_id),
        (v_stage_finishing_id),
        (v_stage_acceptance_id)
    ) AS stage_rows(stage_id)
    WHERE stage_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM project_stage_assignments psa WHERE psa.user_id = v_manager_id AND psa.stage_id = stage_id
      );
  END IF;

  IF v_worker_id IS NOT NULL THEN
    INSERT INTO project_stage_assignments (user_id, project_id, stage_id, assignment_role, work_start, work_end)
    SELECT v_worker_id, v_project_id, stage_id, 'Thi cong', NOW() - INTERVAL '20 days', NOW() + INTERVAL '20 days'
    FROM (
      VALUES
        (v_stage_foundation_id),
        (v_stage_structure_id)
    ) AS stage_rows(stage_id)
    WHERE stage_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM project_stage_assignments psa WHERE psa.user_id = v_worker_id AND psa.stage_id = stage_id
      );
  END IF;

  INSERT INTO project_plan_boq_items
    (project_id, stage_id, item_type, wbs_code, parent_wbs_code, dependency_wbs_code, dependency_type, item_name, description, unit, quantity, unit_cost, status, planned_date, planned_end_date, actual_date, actual_end_date, created_by, updated_by)
  SELECT
    v_project_id,
    seed.stage_id,
    seed.item_type,
    seed.wbs_code,
    seed.parent_wbs_code,
    seed.dependency_wbs_code,
    seed.dependency_type,
    seed.item_name,
    seed.description,
    seed.unit,
    seed.quantity,
    seed.unit_cost,
    seed.status,
    seed.planned_date,
    seed.planned_end_date,
    seed.actual_date,
    seed.actual_end_date,
    v_manager_id,
    v_manager_id
  FROM (
    VALUES
      (v_stage_preparation_id, 'PLAN', '1.1', NULL, NULL, NULL, 'Mobilization and site survey', 'Prepare temporary office and survey benchmarks', 'package', 1::numeric, 15000000::numeric, 'DONE', CURRENT_DATE - 30, CURRENT_DATE - 27, CURRENT_DATE - 30, CURRENT_DATE - 27),
      (v_stage_foundation_id, 'BOQ', '2.1', NULL, '1.1', 'FS', 'Excavation for footings', 'Excavate for isolated footings', 'm3', 320::numeric, 180000::numeric, 'DONE', CURRENT_DATE - 26, CURRENT_DATE - 20, CURRENT_DATE - 26, CURRENT_DATE - 20),
      (v_stage_foundation_id, 'BOQ', '2.2', '2.1', NULL, NULL, 'Lean concrete', 'Concrete blinding before reinforcement', 'm3', 45::numeric, 1200000::numeric, 'IN_PROGRESS', CURRENT_DATE - 19, CURRENT_DATE - 14, CURRENT_DATE - 18, NULL),
      (v_stage_structure_id, 'BOQ', '3.1', NULL, '2.2', 'FS', 'Column reinforcement', 'Rebar installation for columns', 'ton', 28::numeric, 16500000::numeric, 'IN_PROGRESS', CURRENT_DATE - 12, CURRENT_DATE - 3, CURRENT_DATE - 10, NULL),
      (v_stage_structure_id, 'BOQ', '3.2', '3.1', NULL, NULL, 'Slab formwork', 'Install formwork and shoring for slab', 'm2', 680::numeric, 175000::numeric, 'PLANNED', CURRENT_DATE - 5, CURRENT_DATE + 5, NULL, NULL),
      (v_stage_finishing_id, 'PLAN', '4.1', NULL, '3.2', 'FS', 'M&E rough-in', 'Install conduit and piping rough-ins', 'package', 1::numeric, 70000000::numeric, 'PLANNED', CURRENT_DATE + 7, CURRENT_DATE + 25, NULL, NULL),
      (v_stage_acceptance_id, 'PLAN', '5.1', NULL, '4.1', 'FS', 'Final inspection', 'Complete snag list and final acceptance', 'package', 1::numeric, 25000000::numeric, 'PLANNED', CURRENT_DATE + 26, CURRENT_DATE + 35, NULL, NULL)
  ) AS seed(stage_id, item_type, wbs_code, parent_wbs_code, dependency_wbs_code, dependency_type, item_name, description, unit, quantity, unit_cost, status, planned_date, planned_end_date, actual_date, actual_end_date)
  WHERE seed.stage_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM project_plan_boq_items pbi WHERE pbi.project_id = v_project_id AND pbi.wbs_code = seed.wbs_code
    );

  INSERT INTO project_material_logs
    (project_id, material_name, unit, planned_qty, received_qty, used_qty, unit_cost, supplier, status, note, created_by, updated_by)
  SELECT
    v_project_id,
    seed.material_name,
    seed.unit,
    seed.planned_qty,
    seed.received_qty,
    seed.used_qty,
    seed.unit_cost,
    seed.supplier,
    seed.status,
    seed.note,
    v_manager_id,
    v_manager_id
  FROM (
    VALUES
      ('Rebar D16', 'kg', 18000::numeric, 16000::numeric, 14000::numeric, 18500::numeric, 'Hoa Phat', 'IN_PROGRESS', 'Delivery split into 2 batches'),
      ('Cement PCB40', 'bag', 5200::numeric, 5000::numeric, 4200::numeric, 87000::numeric, 'Vicem', 'IN_PROGRESS', 'On track for foundation completion'),
      ('Sand', 'm3', 420::numeric, 430::numeric, 360::numeric, 270000::numeric, 'Binh Duong Supplier', 'IN_PROGRESS', 'Stock available for next 10 days'),
      ('Brick 4-hole', 'piece', 90000::numeric, 15000::numeric, 5000::numeric, 1550::numeric, 'Local factory', 'PLANNED', 'Reserved for finishing stage')
  ) AS seed(material_name, unit, planned_qty, received_qty, used_qty, unit_cost, supplier, status, note)
  WHERE NOT EXISTS (
    SELECT 1 FROM project_material_logs pml WHERE pml.project_id = v_project_id AND pml.material_name = seed.material_name
  );

  INSERT INTO project_resource_allocations
    (project_id, resource_type, resource_name, quantity, unit, hourly_rate, working_hours, status, note, created_by, updated_by)
  SELECT
    v_project_id,
    seed.resource_type,
    seed.resource_name,
    seed.quantity,
    seed.unit,
    seed.hourly_rate,
    seed.working_hours,
    seed.status,
    seed.note,
    v_manager_id,
    v_manager_id
  FROM (
    VALUES
      ('LABOR', 'Steel fixer team', 12::numeric, 'person', 65000::numeric, 208::numeric, 'IN_PROGRESS', 'Night shift added for deadline'),
      ('LABOR', 'Concrete crew', 10::numeric, 'person', 62000::numeric, 208::numeric, 'IN_PROGRESS', 'Maintain pouring sequence'),
      ('EQUIPMENT', 'Tower crane support', 1::numeric, 'set', 450000::numeric, 160::numeric, 'IN_PROGRESS', 'Shared with structure stage'),
      ('EQUIPMENT', 'Vibratory compactor', 2::numeric, 'unit', 220000::numeric, 120::numeric, 'PLANNED', 'For finishing groundwork')
  ) AS seed(resource_type, resource_name, quantity, unit, hourly_rate, working_hours, status, note)
  WHERE NOT EXISTS (
    SELECT 1 FROM project_resource_allocations pra WHERE pra.project_id = v_project_id AND pra.resource_type = seed.resource_type AND pra.resource_name = seed.resource_name
  );

  INSERT INTO project_cost_entries
    (project_id, category, description, amount, incurred_on, status, created_by, updated_by)
  SELECT
    v_project_id,
    seed.category,
    seed.description,
    seed.amount,
    seed.incurred_on,
    seed.status,
    v_manager_id,
    v_manager_id
  FROM (
    VALUES
      ('MATERIAL', 'Concrete and reinforcement procurement', 385000000::numeric, CURRENT_DATE - 14, 'APPROVED'),
      ('LABOR', 'Monthly labor payroll', 168000000::numeric, CURRENT_DATE - 7, 'APPROVED'),
      ('EQUIPMENT', 'Crane rental and operation', 96000000::numeric, CURRENT_DATE - 5, 'DRAFT'),
      ('SAFETY', 'PPE and safety signage', 22000000::numeric, CURRENT_DATE - 3, 'APPROVED')
  ) AS seed(category, description, amount, incurred_on, status)
  WHERE NOT EXISTS (
    SELECT 1 FROM project_cost_entries pce WHERE pce.project_id = v_project_id AND pce.category = seed.category AND pce.description = seed.description
  );

  INSERT INTO project_budget_plans
    (project_id, planned_budget, planned_disbursement, planned_revenue, note, updated_by)
  VALUES
    (v_project_id, 1850000000::numeric, 1520000000::numeric, 2100000000::numeric, 'Seed budget for project manager testing', v_manager_id)
  ON CONFLICT (project_id) DO UPDATE
  SET planned_budget = EXCLUDED.planned_budget,
      planned_disbursement = EXCLUDED.planned_disbursement,
      planned_revenue = EXCLUDED.planned_revenue,
      note = EXCLUDED.note,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW();

  INSERT INTO project_budget_vouchers
    (project_id, voucher_code, voucher_type, category, amount, voucher_date, status, description, created_by, updated_by)
  SELECT
    v_project_id,
    seed.voucher_code,
    seed.voucher_type,
    seed.category,
    seed.amount,
    seed.voucher_date,
    seed.status,
    seed.description,
    v_manager_id,
    v_manager_id
  FROM (
    VALUES
      ('PV-2026-001', 'EXPENSE', 'MATERIAL', 280000000::numeric, CURRENT_DATE - 15, 'PAID', 'Batch payment for rebar and cement'),
      ('PV-2026-002', 'EXPENSE', 'LABOR', 84000000::numeric, CURRENT_DATE - 8, 'PAID', 'Payroll advance'),
      ('PV-2026-003', 'EXPENSE', 'EQUIPMENT', 45000000::numeric, CURRENT_DATE - 6, 'DRAFT', 'Crane operator package'),
      ('PV-2026-004', 'INCOME', 'OWNER_PAYMENT', 300000000::numeric, CURRENT_DATE - 4, 'PAID', 'First progress payment from owner')
  ) AS seed(voucher_code, voucher_type, category, amount, voucher_date, status, description)
  WHERE NOT EXISTS (
    SELECT 1 FROM project_budget_vouchers pbv WHERE pbv.project_id = v_project_id AND pbv.voucher_code = seed.voucher_code
  );

  INSERT INTO project_acceptance_records
    (project_id, title, phase, accepted_by, accepted_on, status, note, created_by, updated_by)
  SELECT
    v_project_id,
    seed.title,
    seed.phase,
    seed.accepted_by,
    seed.accepted_on,
    seed.status,
    seed.note,
    v_manager_id,
    v_manager_id
  FROM (
    VALUES
      ('Site mobilization accepted', 'Preparation', 'QA Team', CURRENT_DATE - 24, 'APPROVED', 'Temporary works and setup accepted'),
      ('Footing excavation check', 'Foundation Construction', 'Consultant', CURRENT_DATE - 18, 'APPROVED', 'Depth and dimensions passed'),
      ('Rebar inspection level 1', 'Structure Construction', 'Consultant', CURRENT_DATE - 2, 'PENDING', 'Awaiting slab section B')
  ) AS seed(title, phase, accepted_by, accepted_on, status, note)
  WHERE NOT EXISTS (
    SELECT 1 FROM project_acceptance_records par WHERE par.project_id = v_project_id AND par.title = seed.title
  );

  INSERT INTO project_construction_diaries
    (project_id, diary_code, diary_date, title, work_content, issues, weather, weather_morning, weather_afternoon, weather_evening, weather_night, site_condition, temperature, incident_report, safety_rating, quality_rating, progress_rating, hygiene_rating, proposal, report_watchers, note, status, created_by, updated_by)
  SELECT
    v_project_id,
    seed.diary_code,
    seed.diary_date,
    seed.title,
    seed.work_content,
    seed.issues,
    seed.weather,
    seed.weather_morning,
    seed.weather_afternoon,
    seed.weather_evening,
    seed.weather_night,
    seed.site_condition,
    seed.temperature,
    seed.incident_report,
    seed.safety_rating,
    seed.quality_rating,
    seed.progress_rating,
    seed.hygiene_rating,
    seed.proposal,
    seed.report_watchers,
    seed.note,
    seed.status,
    v_manager_id,
    v_manager_id
  FROM (
    VALUES
      ('DK-2026-001', CURRENT_DATE - 3, 'Foundation concrete pour section A', 'Completed concrete pour 120m3 and rebar check.', 'No critical issue.', 'Cloudy', 'Cloudy', 'Light rain', 'Cloudy', 'Dry', 'Ground stable', '31C', NULL, 'TOT', 'TOT', 'TOT', 'TOT', 'Continue section B tomorrow', 'Manager, Safety Officer', 'All crews complied with PPE', 'CLOSED'),
      ('DK-2026-002', CURRENT_DATE - 2, 'Column reinforcement and formwork', 'Installed column bars for axis C-D.', 'Minor shortage of tie wire.', 'Sunny', 'Sunny', 'Sunny', 'Clear', 'Dry', 'Access road dry', '33C', 'No incident', 'TOT', 'TOT', 'TRUNG_BINH', 'TOT', 'Expedite wire delivery', 'Manager, QA', 'Need extra inspection at 16:00', 'OPEN'),
      ('DK-2026-003', CURRENT_DATE - 1, 'Slab formwork preparation', 'Prepared deck area and checked elevation points.', 'One scaffold joint replacement.', 'Hot', 'Sunny', 'Hot', 'Clear', 'Dry', 'Safe for operation', '34C', 'Near miss reported and resolved', 'TOT', 'TOT', 'TRUNG_BINH', 'TOT', 'Add second survey team', 'Manager, Site Engineer', 'Close outstanding scaffold issue by next shift', 'OPEN')
  ) AS seed(diary_code, diary_date, title, work_content, issues, weather, weather_morning, weather_afternoon, weather_evening, weather_night, site_condition, temperature, incident_report, safety_rating, quality_rating, progress_rating, hygiene_rating, proposal, report_watchers, note, status)
  WHERE NOT EXISTS (
    SELECT 1 FROM project_construction_diaries pcd WHERE pcd.project_id = v_project_id AND pcd.diary_code = seed.diary_code
  );

  INSERT INTO project_rfx_records
    (project_id, rfx_type, title, priority, status, description, requested_by, due_date, resolved_on, created_by, updated_by)
  SELECT
    v_project_id,
    seed.rfx_type,
    seed.title,
    seed.priority,
    seed.status,
    seed.description,
    seed.requested_by,
    seed.due_date,
    seed.resolved_on,
    v_manager_id,
    v_manager_id
  FROM (
    VALUES
      ('RFI', 'Clarify slab opening dimensions', 'NORMAL', 'OPEN', 'Need consultant clarification on revised MEP openings.', 'Site Engineer', CURRENT_DATE + 2, NULL::date),
      ('SUBMITTAL', 'Rebar mill certificates package', 'HIGH', 'OPEN', 'Submit certificates for D16/D20 batch 05.', 'QA Officer', CURRENT_DATE + 1, NULL::date),
      ('ISSUE', 'Tower crane downtime alert', 'CRITICAL', 'OPEN', 'Unexpected crane brake fault; pending replacement parts.', 'Equipment Lead', CURRENT_DATE, NULL::date)
  ) AS seed(rfx_type, title, priority, status, description, requested_by, due_date, resolved_on)
  WHERE NOT EXISTS (
    SELECT 1 FROM project_rfx_records prr WHERE prr.project_id = v_project_id AND prr.title = seed.title
  );

  INSERT INTO project_equipment_assets
    (project_id, license_plate, equipment_type, brand, model, vin_no, engine_no, fuel_type, ownership_type, driver_name, driver_code, driver_phone, rental_vendor, status, note, created_by, updated_by)
  SELECT
    v_project_id,
    seed.license_plate,
    seed.equipment_type,
    seed.brand,
    seed.model,
    seed.vin_no,
    seed.engine_no,
    seed.fuel_type,
    seed.ownership_type,
    seed.driver_name,
    seed.driver_code,
    seed.driver_phone,
    seed.rental_vendor,
    seed.status,
    seed.note,
    v_manager_id,
    v_manager_id
  FROM (
    VALUES
      ('61C-12345', 'EXCAVATOR', 'CAT', '320D2', 'VIN-EXC-320D2-001', 'ENG-EXC-001', 'DIESEL', 'OWNED', 'Nguyen Van A', 'DRV001', '0901000001', NULL, 'ACTIVE', 'Primary excavation machine'),
      ('51D-67890', 'TRUCK_CRANE', 'KATO', 'KR25H', 'VIN-CRN-KR25-009', 'ENG-CRN-009', 'DIESEL', 'RENTED', 'Tran Van B', 'DRV002', '0901000002', 'ABC Equipment Rental', 'ACTIVE', 'Used for lifting formwork panels')
  ) AS seed(license_plate, equipment_type, brand, model, vin_no, engine_no, fuel_type, ownership_type, driver_name, driver_code, driver_phone, rental_vendor, status, note)
  WHERE NOT EXISTS (
    SELECT 1 FROM project_equipment_assets pea WHERE pea.project_id = v_project_id AND pea.license_plate = seed.license_plate
  );

  SELECT id INTO v_excavator_id FROM project_equipment_assets WHERE project_id = v_project_id AND license_plate = '61C-12345' ORDER BY id DESC LIMIT 1;
  SELECT id INTO v_crane_id FROM project_equipment_assets WHERE project_id = v_project_id AND license_plate = '51D-67890' ORDER BY id DESC LIMIT 1;

  INSERT INTO project_equipment_logs
    (project_id, equipment_id, log_type, log_date, title, description, trip_count, distance_km, fuel_liters, odometer_km, cost_amount, status, created_by, updated_by)
  SELECT
    v_project_id,
    seed.equipment_id,
    seed.log_type,
    seed.log_date,
    seed.title,
    seed.description,
    seed.trip_count,
    seed.distance_km,
    seed.fuel_liters,
    seed.odometer_km,
    seed.cost_amount,
    seed.status,
    v_manager_id,
    v_manager_id
  FROM (
    VALUES
      (v_excavator_id, 'TRIP_SHIFT', CURRENT_DATE - 3, 'Excavation shift A', 'Completed foundation pit area A.', 8, 24::numeric, 62::numeric, 12045::numeric, 420000::numeric, 'DONE'),
      (v_excavator_id, 'FUEL', CURRENT_DATE - 2, 'Fuel refill', 'Refilled diesel tank to full capacity.', NULL, NULL, 95::numeric, 12087::numeric, 2150000::numeric, 'DONE'),
      (v_crane_id, 'MAINTENANCE', CURRENT_DATE - 1, 'Brake inspection', 'Preventive maintenance before heavy lift.', NULL, NULL, NULL, 5832::numeric, 3400000::numeric, 'DONE'),
      (v_crane_id, 'MOVEMENT', CURRENT_DATE, 'Move to zone C', 'Relocated for slab formwork lifting.', 3, 7::numeric, 18::numeric, 5841::numeric, 350000::numeric, 'IN_PROGRESS')
  ) AS seed(equipment_id, log_type, log_date, title, description, trip_count, distance_km, fuel_liters, odometer_km, cost_amount, status)
  WHERE seed.equipment_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM project_equipment_logs pel
      WHERE pel.project_id = v_project_id
        AND pel.equipment_id = seed.equipment_id
        AND pel.log_type = seed.log_type
        AND pel.log_date = seed.log_date
        AND COALESCE(pel.title, '') = COALESCE(seed.title, '')
    );

  INSERT INTO project_progress_updates
    (project_id, progress_percent, note, updated_by, created_at)
  SELECT
    v_project_id,
    seed.progress_percent,
    seed.note,
    v_manager_id,
    seed.created_at
  FROM (
    VALUES
      (12, 'Initial mobilization complete', NOW() - INTERVAL '28 days'),
      (34, 'Foundation works accelerated after extra crew', NOW() - INTERVAL '15 days'),
      (47, 'Structure stage started, progress stable', NOW() - INTERVAL '2 days')
  ) AS seed(progress_percent, note, created_at)
  WHERE NOT EXISTS (
    SELECT 1
    FROM project_progress_updates ppu
    WHERE ppu.project_id = v_project_id
      AND ppu.progress_percent = seed.progress_percent
      AND ppu.created_at::date = seed.created_at::date
  );

  INSERT INTO attendance_logs
    (user_id, project_id, check_in_time, check_out_time, check_in_latitude, check_in_longitude, check_out_latitude, check_out_longitude, face_score)
  SELECT
    v_worker_id,
    v_project_id,
    seed.check_in_time,
    seed.check_out_time,
    10.9804,
    106.6519,
    10.9804,
    106.6519,
    seed.face_score
  FROM (
    VALUES
      (NOW() - INTERVAL '3 days' + INTERVAL '8 hours', NOW() - INTERVAL '3 days' + INTERVAL '17 hours', 0.93::numeric),
      (NOW() - INTERVAL '2 days' + INTERVAL '8 hours', NOW() - INTERVAL '2 days' + INTERVAL '17 hours', 0.95::numeric),
      (NOW() - INTERVAL '1 days' + INTERVAL '8 hours', NOW() - INTERVAL '1 days' + INTERVAL '17 hours', 0.94::numeric)
  ) AS seed(check_in_time, check_out_time, face_score)
  WHERE v_worker_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM attendance_logs al
      WHERE al.user_id = v_worker_id
        AND al.project_id = v_project_id
        AND al.check_in_time::date = seed.check_in_time::date
    );

  UPDATE projects
  SET status = 'IN_PROGRESS',
      progress_percent = GREATEST(progress_percent, 47),
      updated_at = NOW()
  WHERE id = v_project_id;
END $$;

