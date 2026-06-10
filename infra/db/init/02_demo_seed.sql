-- Demo seed data for MDP System.
-- Run after 01_schema.sql. This script is idempotent for the fixed demo codes below.
-- Demo password for all ACTIVE demo accounts: 123456

BEGIN;

CREATE TABLE IF NOT EXISTS workforce_quota_requests (
  id SERIAL PRIMARY KEY,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  shift_code VARCHAR(30) NOT NULL,
  trade_code VARCHAR(30) NOT NULL,
  requested_count INTEGER NOT NULL CHECK (requested_count >= 0),
  status VARCHAR(20) NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'CANCELLED')),
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (project_id, from_date, to_date, shift_code, trade_code)
);

CREATE INDEX IF NOT EXISTS idx_workforce_quota_requests_lookup
ON workforce_quota_requests (project_id, from_date, to_date, shift_code, status);

ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_type_check;
ALTER TABLE requests
ADD CONSTRAINT requests_type_check
CHECK (type IN ('leave', 'late', 'overtime', 'forgot_checkout', 'LEAVE', 'OT', 'MISSED_PUNCH'));

-- Keep reruns predictable: remove only previous demo records with fixed demo codes.
DELETE FROM projects
WHERE project_code LIKE 'PRJ-DEMO-%';

DELETE FROM users
WHERE employee_code IN ('00000001', '00000002', '00000003', '00000004', '00000005', '00000006')
   OR employee_code BETWEEN '00000101' AND '00000105'
   OR employee_code BETWEEN '00000201' AND '00000205'
   OR employee_code BETWEEN '00000301' AND '00000305'
   OR employee_code BETWEEN '00000401' AND '00000405'
   OR employee_code BETWEEN '00000501' AND '00000505'
   OR employee_code BETWEEN '00000601' AND '00000605'
   OR email IN ('admin@mdp.local', 'manager@mdp.local', 'hr@mdp.local', 'supervisor@mdp.local', 'worker@mdp.local', 'locked@mdp.local', 'inactive@mdp.local')
   OR email LIKE 'prep%@mdp.local'
   OR email LIKE 'foundation%@mdp.local'
   OR email LIKE 'structure%@mdp.local'
   OR email LIKE 'finishing%@mdp.local'
   OR email LIKE 'equipment%@mdp.local'
   OR email LIKE 'warehouse%@mdp.local';

DELETE FROM data_logs
WHERE service_name = 'demo-seed'
   OR (metadata ->> 'demo') = 'true';

INSERT INTO job_titles (code, name, category, is_active)
VALUES
  ('SYS_ADMIN', 'System Administrator', 'ADMINISTRATION', TRUE),
  ('HR_MANAGER', 'HR Manager', 'ADMINISTRATION', TRUE),
  ('PROJECT_MANAGER', 'Project Manager', 'PROJECT', TRUE),
  ('SITE_SUPERVISOR', 'Site Supervisor', 'PROJECT', TRUE),
  ('PREPARATION_WORKER', 'Preparation Worker', 'WORKFORCE', TRUE),
  ('FOUNDATION_WORKER', 'Foundation Worker', 'WORKFORCE', TRUE),
  ('STRUCTURE_WORKER', 'Structure Worker', 'WORKFORCE', TRUE),
  ('FINISHING_WORKER', 'Finishing Worker', 'WORKFORCE', TRUE),
  ('EQUIPMENT_OPERATOR', 'Equipment Operator', 'EQUIPMENT', TRUE),
  ('WAREHOUSE_KEEPER', 'Warehouse Keeper', 'MATERIAL', TRUE)
ON CONFLICT (code) DO UPDATE
SET name = EXCLUDED.name,
    category = EXCLUDED.category,
    is_active = EXCLUDED.is_active,
    updated_at = NOW();

WITH demo_users(employee_code, first_name, last_name, full_name, phone, email, gender, birth_date, address, status, job_title, skill_level, trade_code, specialization, hourly_rate, base_monthly_salary, face_status) AS (
  VALUES
    ('00000001', 'System', 'Admin', 'System Admin', '0901000001', 'admin@mdp.local', 'Male', DATE '1988-01-05', 'Ho Chi Minh City', 'WORKING', 'System Administrator', 'SENIOR', 'ADMINISTRATION', 'Platform administration', 90000, 22000000, 'APPROVED'),
    ('00000002', 'Project', 'Manager', 'Project Manager', '0901000002', 'manager@mdp.local', 'Male', DATE '1990-02-14', 'Binh Duong', 'WORKING', 'Project Manager', 'SENIOR', 'PROJECT_MANAGEMENT', 'Warehouse and fit-out projects', 85000, 21000000, 'APPROVED'),
    ('00000003', 'Human', 'Resources', 'Human Resources Manager', '0901000003', 'hr@mdp.local', 'Female', DATE '1991-03-20', 'Ho Chi Minh City', 'WORKING', 'HR Manager', 'SENIOR', 'HR', 'Workforce administration', 80000, 20000000, 'APPROVED'),
    ('00000004', 'Site', 'Supervisor', 'Site Supervisor', '0901000004', 'supervisor@mdp.local', 'Male', DATE '1989-04-18', 'Binh Duong', 'WORKING', 'Site Supervisor', 'SENIOR', 'PROJECT_MANAGEMENT', 'Daily site control', 70000, 18000000, 'APPROVED'),
    ('00000005', 'Locked', 'Employee', 'Locked Employee Demo', '0901000005', 'locked@mdp.local', 'Male', DATE '1995-05-05', 'Dong Nai', 'WORKING', 'Finishing Worker', 'JUNIOR', 'FINISHING', 'Locked account demo', 45000, 10000000, 'APPROVED'),
    ('00000006', 'Inactive', 'Employee', 'Inactive Employee Demo', '0901000006', 'inactive@mdp.local', 'Female', DATE '1996-06-06', 'Dong Nai', 'WORKING', 'Warehouse Keeper', 'JUNIOR', 'WAREHOUSE', 'Inactive account demo', 43000, 9500000, 'UNREGISTERED'),

    ('00000101', 'An', 'Nguyen', 'Nguyen An', '0901100101', 'prep01@mdp.local', 'Male', DATE '1998-01-11', 'Thu Dau Mot', 'WORKING', 'Preparation Worker', 'SENIOR', 'PREPARATION', 'Survey and site clearance', 43000, 9800000, 'APPROVED'),
    ('00000102', 'Binh', 'Tran', 'Tran Binh', '0901100102', 'prep02@mdp.local', 'Male', DATE '1999-02-12', 'Thu Dau Mot', 'WORKING', 'Preparation Worker', 'MID', 'PREPARATION', 'Temporary works', 41000, 9400000, 'PENDING'),
    ('00000103', 'Chi', 'Le', 'Le Chi', '0901100103', 'prep03@mdp.local', 'Female', DATE '2000-03-13', 'Di An', 'WORKING', 'Preparation Worker', 'MID', 'PREPARATION', 'Site cleaning', 40000, 9200000, 'APPROVED'),
    ('00000104', 'Dung', 'Pham', 'Pham Dung', '0901100104', 'prep04@mdp.local', 'Male', DATE '1997-04-14', 'Di An', 'WORKING', 'Preparation Worker', 'JUNIOR', 'PREPARATION', 'Material staging', 39000, 9000000, 'REJECTED'),
    ('00000105', 'Em', 'Vo', 'Vo Em', '0901100105', 'prep05@mdp.local', 'Male', DATE '1996-05-15', 'Ben Cat', 'WORKING', 'Preparation Worker', 'JUNIOR', 'PREPARATION', 'Traffic control', 39000, 9000000, 'UNREGISTERED'),

    ('00000201', 'Giang', 'Ho', 'Ho Giang', '0901200201', 'foundation01@mdp.local', 'Male', DATE '1994-01-21', 'Binh Duong', 'WORKING', 'Foundation Worker', 'SENIOR', 'FOUNDATION', 'Excavation leader', 50000, 11500000, 'APPROVED'),
    ('00000202', 'Hieu', 'Dang', 'Dang Hieu', '0901200202', 'foundation02@mdp.local', 'Male', DATE '1995-02-22', 'Binh Duong', 'WORKING', 'Foundation Worker', 'MID', 'FOUNDATION', 'Rebar foundation', 47000, 10800000, 'APPROVED'),
    ('00000203', 'Khanh', 'Do', 'Do Khanh', '0901200203', 'foundation03@mdp.local', 'Male', DATE '1998-03-23', 'Dong Nai', 'WORKING', 'Foundation Worker', 'MID', 'FOUNDATION', 'Concrete pouring', 46000, 10600000, 'PENDING'),
    ('00000204', 'Lam', 'Bui', 'Bui Lam', '0901200204', 'foundation04@mdp.local', 'Male', DATE '1999-04-24', 'Dong Nai', 'WORKING', 'Foundation Worker', 'JUNIOR', 'FOUNDATION', 'Backfilling', 43000, 9900000, 'APPROVED'),
    ('00000205', 'Minh', 'Phan', 'Phan Minh', '0901200205', 'foundation05@mdp.local', 'Male', DATE '2000-05-25', 'Long An', 'WORKING', 'Foundation Worker', 'JUNIOR', 'FOUNDATION', 'Compaction', 43000, 9900000, 'UNREGISTERED'),

    ('00000301', 'Nam', 'Dinh', 'Dinh Nam', '0901300301', 'structure01@mdp.local', 'Male', DATE '1993-01-31', 'Binh Duong', 'WORKING', 'Structure Worker', 'SENIOR', 'STRUCTURE', 'Formwork leader', 56000, 12800000, 'APPROVED'),
    ('00000302', 'Oanh', 'Mai', 'Mai Oanh', '0901300302', 'structure02@mdp.local', 'Female', DATE '1997-02-01', 'Binh Duong', 'WORKING', 'Structure Worker', 'MID', 'STRUCTURE', 'Steel fixing', 52000, 11900000, 'APPROVED'),
    ('00000303', 'Phuc', 'Ly', 'Ly Phuc', '0901300303', 'structure03@mdp.local', 'Male', DATE '1996-03-02', 'Dong Nai', 'WORKING', 'Structure Worker', 'MID', 'STRUCTURE', 'Column casting', 51000, 11700000, 'PENDING'),
    ('00000304', 'Quang', 'Ta', 'Ta Quang', '0901300304', 'structure04@mdp.local', 'Male', DATE '1999-04-03', 'Dong Nai', 'WORKING', 'Structure Worker', 'JUNIOR', 'STRUCTURE', 'Beam installation', 47000, 10800000, 'APPROVED'),
    ('00000305', 'Rin', 'Cao', 'Cao Rin', '0901300305', 'structure05@mdp.local', 'Male', DATE '2000-05-04', 'Long An', 'WORKING', 'Structure Worker', 'JUNIOR', 'STRUCTURE', 'Slab support', 47000, 10800000, 'REJECTED'),

    ('00000401', 'Son', 'Truong', 'Truong Son', '0901400401', 'finishing01@mdp.local', 'Male', DATE '1994-06-11', 'Binh Duong', 'WORKING', 'Finishing Worker', 'SENIOR', 'FINISHING', 'Plastering leader', 52000, 11900000, 'APPROVED'),
    ('00000402', 'Tam', 'Vu', 'Vu Tam', '0901400402', 'finishing02@mdp.local', 'Male', DATE '1995-07-12', 'Binh Duong', 'WORKING', 'Finishing Worker', 'MID', 'FINISHING', 'Painting', 48000, 11000000, 'APPROVED'),
    ('00000403', 'Uyen', 'Ngo', 'Ngo Uyen', '0901400403', 'finishing03@mdp.local', 'Female', DATE '1998-08-13', 'Dong Nai', 'WORKING', 'Finishing Worker', 'MID', 'FINISHING', 'Tiling', 47000, 10800000, 'PENDING'),
    ('00000404', 'Vi', 'Ha', 'Ha Vi', '0901400404', 'finishing04@mdp.local', 'Female', DATE '1999-09-14', 'Dong Nai', 'WORKING', 'Finishing Worker', 'JUNIOR', 'FINISHING', 'Ceiling works', 44000, 10100000, 'APPROVED'),
    ('00000405', 'Xuan', 'Luu', 'Luu Xuan', '0901400405', 'finishing05@mdp.local', 'Male', DATE '2000-10-15', 'Long An', 'WORKING', 'Finishing Worker', 'JUNIOR', 'FINISHING', 'Cleaning punch list', 43000, 9900000, 'UNREGISTERED'),

    ('00000501', 'Hoang', 'Nguyen', 'Nguyen Hoang', '0901500501', 'equipment01@mdp.local', 'Male', DATE '1989-01-07', 'Binh Duong', 'WORKING', 'Equipment Operator', 'SENIOR', 'EQUIPMENT', 'Tower crane operator', 62000, 14200000, 'APPROVED'),
    ('00000502', 'Loc', 'Tran', 'Tran Loc', '0901500502', 'equipment02@mdp.local', 'Male', DATE '1990-02-08', 'Binh Duong', 'WORKING', 'Equipment Operator', 'SENIOR', 'EQUIPMENT', 'Excavator operator', 60000, 13800000, 'APPROVED'),
    ('00000503', 'Phong', 'Le', 'Le Phong', '0901500503', 'equipment03@mdp.local', 'Male', DATE '1992-03-09', 'Dong Nai', 'WORKING', 'Equipment Operator', 'MID', 'EQUIPMENT', 'Truck driver', 56000, 12800000, 'APPROVED'),
    ('00000504', 'Thai', 'Pham', 'Pham Thai', '0901500504', 'equipment04@mdp.local', 'Male', DATE '1994-04-10', 'Dong Nai', 'WORKING', 'Equipment Operator', 'MID', 'EQUIPMENT', 'Forklift operator', 54000, 12400000, 'PENDING'),
    ('00000505', 'Vinh', 'Do', 'Do Vinh', '0901500505', 'equipment05@mdp.local', 'Male', DATE '1995-05-11', 'Long An', 'WORKING', 'Equipment Operator', 'JUNIOR', 'EQUIPMENT', 'Water truck driver', 50000, 11500000, 'UNREGISTERED'),

    ('00000601', 'Bao', 'Vo', 'Vo Bao', '0901600601', 'warehouse01@mdp.local', 'Male', DATE '1994-06-21', 'Binh Duong', 'WORKING', 'Warehouse Keeper', 'SENIOR', 'WAREHOUSE', 'Material receiving', 47000, 10800000, 'APPROVED'),
    ('00000602', 'Cuong', 'Huynh', 'Huynh Cuong', '0901600602', 'warehouse02@mdp.local', 'Male', DATE '1995-07-22', 'Binh Duong', 'WORKING', 'Warehouse Keeper', 'MID', 'WAREHOUSE', 'Stock counting', 45000, 10400000, 'APPROVED'),
    ('00000603', 'Dao', 'Vo', 'Vo Dao', '0901600603', 'warehouse03@mdp.local', 'Female', DATE '1996-08-23', 'Dong Nai', 'WORKING', 'Warehouse Keeper', 'MID', 'WAREHOUSE', 'Delivery documents', 44000, 10100000, 'PENDING'),
    ('00000604', 'Hanh', 'Pham', 'Pham Hanh', '0901600604', 'warehouse04@mdp.local', 'Female', DATE '1998-09-24', 'Dong Nai', 'WORKING', 'Warehouse Keeper', 'JUNIOR', 'WAREHOUSE', 'Stock issue', 41000, 9400000, 'APPROVED'),
    ('00000605', 'Kiet', 'Nguyen', 'Nguyen Kiet', '0901600605', 'warehouse05@mdp.local', 'Male', DATE '1999-10-25', 'Long An', 'RESIGNED', 'Warehouse Keeper', 'JUNIOR', 'WAREHOUSE', 'Resigned demo worker', 40000, 9200000, 'UNREGISTERED')
)
INSERT INTO users (
  employee_code, first_name, last_name, full_name, phone, email, gender, birth_date, address, status,
  job_title, skill_level, trade_code, specialization, hourly_rate, base_monthly_salary,
  face_enrollment_status, face_template, face_enrollment_submitted_at, face_enrollment_reviewed_at,
  face_enrollment_note, job_title_id, updated_at
)
SELECT
  du.employee_code, du.first_name, du.last_name, du.full_name, du.phone, du.email, du.gender, du.birth_date, du.address, du.status,
  du.job_title, du.skill_level, du.trade_code, du.specialization, du.hourly_rate, du.base_monthly_salary,
  du.face_status,
  CASE WHEN du.face_status = 'APPROVED' THEN jsonb_build_object('demo', true, 'embeddingVersion', 'demo-v1') ELSE NULL END,
  CASE WHEN du.face_status IN ('PENDING', 'APPROVED', 'REJECTED') THEN NOW() - INTERVAL '5 days' ELSE NULL END,
  CASE WHEN du.face_status IN ('APPROVED', 'REJECTED') THEN NOW() - INTERVAL '4 days' ELSE NULL END,
  CASE WHEN du.face_status = 'REJECTED' THEN 'Demo rejection: sample image is blurry.' ELSE NULL END,
  jt.id,
  NOW()
FROM demo_users du
LEFT JOIN job_titles jt ON jt.name = du.job_title
ON CONFLICT (employee_code) DO UPDATE
SET first_name = EXCLUDED.first_name,
    last_name = EXCLUDED.last_name,
    full_name = EXCLUDED.full_name,
    phone = EXCLUDED.phone,
    email = EXCLUDED.email,
    gender = EXCLUDED.gender,
    birth_date = EXCLUDED.birth_date,
    address = EXCLUDED.address,
    status = EXCLUDED.status,
    job_title = EXCLUDED.job_title,
    skill_level = EXCLUDED.skill_level,
    trade_code = EXCLUDED.trade_code,
    specialization = EXCLUDED.specialization,
    hourly_rate = EXCLUDED.hourly_rate,
    base_monthly_salary = EXCLUDED.base_monthly_salary,
    face_enrollment_status = EXCLUDED.face_enrollment_status,
    face_template = EXCLUDED.face_template,
    face_enrollment_submitted_at = EXCLUDED.face_enrollment_submitted_at,
    face_enrollment_reviewed_at = EXCLUDED.face_enrollment_reviewed_at,
    face_enrollment_note = EXCLUDED.face_enrollment_note,
    job_title_id = EXCLUDED.job_title_id,
    updated_at = NOW();

WITH account_seed(employee_code, desired_role, account_status, failed_login_attempts, locked_until) AS (
  VALUES
    ('00000001', 'SUPER_ADMIN', 'ACTIVE', 0, NULL::timestamp),
    ('00000002', 'PROJECT_MANAGER', 'ACTIVE', 0, NULL::timestamp),
    ('00000003', 'HR_MANAGER', 'ACTIVE', 0, NULL::timestamp),
    ('00000004', 'PROJECT_MANAGER', 'ACTIVE', 0, NULL::timestamp),
    ('00000005', 'EMPLOYEE', 'LOCKED', 5, NOW() + INTERVAL '30 minutes'),
    ('00000006', 'EMPLOYEE', 'INACTIVE', 0, NULL::timestamp)
),
workers AS (
  SELECT employee_code, 'EMPLOYEE'::text AS desired_role, 'ACTIVE'::text AS account_status, 0::int AS failed_login_attempts, NULL::timestamp AS locked_until
  FROM users
  WHERE employee_code BETWEEN '00000101' AND '00000605'
),
all_accounts AS (
  SELECT * FROM account_seed
  UNION ALL
  SELECT * FROM workers
),
resolved AS (
  SELECT
    u.id AS user_id,
    CASE
      WHEN aa.desired_role = 'SUPER_ADMIN'
       AND EXISTS (SELECT 1 FROM accounts a WHERE a.role = 'SUPER_ADMIN' AND a.user_id <> u.id)
      THEN 'ADMIN'
      ELSE aa.desired_role
    END AS role,
    aa.account_status,
    aa.failed_login_attempts,
    aa.locked_until
  FROM all_accounts aa
  JOIN users u ON u.employee_code = aa.employee_code
)
INSERT INTO accounts (user_id, role, password_hash, account_status, failed_login_attempts, locked_until, password_changed_at, updated_at)
SELECT
  user_id,
  role,
  '$2a$10$vJpGJ7NOmQfyn/VaOxfWuesoCuXX6DxG4T01gJoWJ6I7dYkTdW2US',
  account_status,
  failed_login_attempts,
  locked_until,
  NOW(),
  NOW()
FROM resolved
ON CONFLICT (user_id) DO UPDATE
SET role = EXCLUDED.role,
    password_hash = EXCLUDED.password_hash,
    account_status = EXCLUDED.account_status,
    failed_login_attempts = EXCLUDED.failed_login_attempts,
    locked_until = EXCLUDED.locked_until,
    password_changed_at = NOW(),
    updated_at = NOW();

INSERT INTO projects (project_code, name, address, latitude, longitude, start_date, end_date, status, progress_percent, gps_radius_meters, updated_at)
VALUES
  ('PRJ-DEMO-001', 'Binh Duong Warehouse Expansion', 'VSIP II, Binh Duong', 11.0712, 106.6848, CURRENT_DATE - INTERVAL '20 days', CURRENT_DATE + INTERVAL '80 days', 'IN_PROGRESS', 47, 250, NOW()),
  ('PRJ-DEMO-002', 'District 9 Office Tower Fit-out', 'Thu Duc City, Ho Chi Minh City', 10.8411, 106.8098, CURRENT_DATE - INTERVAL '8 days', CURRENT_DATE + INTERVAL '45 days', 'IN_PROGRESS', 28, 150, NOW()),
  ('PRJ-DEMO-003', 'Long An Logistics Center', 'Ben Luc, Long An', 10.6423, 106.4821, CURRENT_DATE + INTERVAL '12 days', CURRENT_DATE + INTERVAL '130 days', 'PLANNING', 5, 300, NOW()),
  ('PRJ-DEMO-004', 'Dong Nai Factory Renovation', 'Bien Hoa, Dong Nai', 10.9447, 106.8243, CURRENT_DATE - INTERVAL '90 days', CURRENT_DATE - INTERVAL '3 days', 'COMPLETED', 100, 200, NOW())
ON CONFLICT (project_code) DO UPDATE
SET name = EXCLUDED.name,
    address = EXCLUDED.address,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    start_date = EXCLUDED.start_date,
    end_date = EXCLUDED.end_date,
    status = EXCLUDED.status,
    progress_percent = EXCLUDED.progress_percent,
    gps_radius_meters = EXCLUDED.gps_radius_meters,
    updated_at = NOW();

DO $$
DECLARE
  pm_id INTEGER;
  hr_id INTEGER;
  sup_id INTEGER;
  p1 INTEGER;
  p2 INTEGER;
  p3 INTEGER;
  p4 INTEGER;
  prep_stage INTEGER;
  foundation_stage INTEGER;
  structure_stage INTEGER;
  finishing_stage INTEGER;
  acceptance_stage INTEGER;
  task_111 INTEGER;
  task_112 INTEGER;
  task_211 INTEGER;
  task_212 INTEGER;
  task_311 INTEGER;
  sand_id INTEGER;
  cement_id INTEGER;
  steel_id INTEGER;
  equipment_asset_id INTEGER;
  worker_id INTEGER;
  idx INTEGER;
BEGIN
  SELECT id INTO pm_id FROM users WHERE employee_code = '00000002';
  SELECT id INTO hr_id FROM users WHERE employee_code = '00000003';
  SELECT id INTO sup_id FROM users WHERE employee_code = '00000004';
  SELECT id INTO p1 FROM projects WHERE project_code = 'PRJ-DEMO-001';
  SELECT id INTO p2 FROM projects WHERE project_code = 'PRJ-DEMO-002';
  SELECT id INTO p3 FROM projects WHERE project_code = 'PRJ-DEMO-003';
  SELECT id INTO p4 FROM projects WHERE project_code = 'PRJ-DEMO-004';

  INSERT INTO project_stages (project_id, stage_name, stage_order, progress_percent, status, weight, started_at, updated_by)
  VALUES
    (p1, 'Preparation', 1, 100, 'DONE', 1, CURRENT_DATE - INTERVAL '20 days', pm_id),
    (p1, 'Foundation Construction', 2, 65, 'IN_PROGRESS', 2, CURRENT_DATE - INTERVAL '8 days', pm_id),
    (p1, 'Structure Construction', 3, 10, 'IN_PROGRESS', 3, CURRENT_DATE - INTERVAL '2 days', pm_id),
    (p1, 'Finishing', 4, 0, 'NOT_STARTED', 2, NULL, pm_id),
    (p1, 'Acceptance', 5, 0, 'NOT_STARTED', 1, NULL, pm_id),
    (p2, 'Preparation', 1, 60, 'IN_PROGRESS', 1, CURRENT_DATE - INTERVAL '8 days', pm_id),
    (p2, 'Finishing', 2, 15, 'IN_PROGRESS', 2, CURRENT_DATE - INTERVAL '3 days', pm_id),
    (p3, 'Preparation', 1, 0, 'NOT_STARTED', 1, NULL, pm_id),
    (p4, 'Acceptance', 5, 100, 'DONE', 1, CURRENT_DATE - INTERVAL '15 days', pm_id)
  ON CONFLICT DO NOTHING;

  SELECT id INTO prep_stage FROM project_stages WHERE project_id = p1 AND stage_name = 'Preparation';
  SELECT id INTO foundation_stage FROM project_stages WHERE project_id = p1 AND stage_name = 'Foundation Construction';
  SELECT id INTO structure_stage FROM project_stages WHERE project_id = p1 AND stage_name = 'Structure Construction';
  SELECT id INTO finishing_stage FROM project_stages WHERE project_id = p1 AND stage_name = 'Finishing';
  SELECT id INTO acceptance_stage FROM project_stages WHERE project_id = p1 AND stage_name = 'Acceptance';

  INSERT INTO project_plan_boq_items
    (project_id, stage_id, item_type, wbs_code, parent_wbs_code, dependency_wbs_code, dependency_type, item_name, description, unit, quantity, unit_cost, status, planned_date, planned_end_date, actual_date, actual_end_date, created_by, updated_by)
  VALUES
    (p1, prep_stage, 'PLAN', '1.1', NULL, NULL, NULL, 'Site preparation', 'Parent work package for site preparation', 'lot', 1, 0, 'IN_PROGRESS', CURRENT_DATE - INTERVAL '20 days', CURRENT_DATE - INTERVAL '12 days', CURRENT_DATE - INTERVAL '20 days', NULL, pm_id, pm_id),
    (p1, prep_stage, 'PLAN', '1.1.1', '1.1', NULL, NULL, 'Existing condition survey', 'Survey current site condition and access roads', 'day', 3, 0, 'DONE', CURRENT_DATE - INTERVAL '20 days', CURRENT_DATE - INTERVAL '18 days', CURRENT_DATE - INTERVAL '20 days', CURRENT_DATE - INTERVAL '18 days', pm_id, pm_id),
    (p1, prep_stage, 'PLAN', '1.1.2', '1.1', '1.1.1', 'FS', 'Site clearing and leveling', 'Clear temporary obstacles and level storage area', 'day', 4, 0, 'IN_PROGRESS', CURRENT_DATE - INTERVAL '17 days', CURRENT_DATE - INTERVAL '14 days', CURRENT_DATE - INTERVAL '17 days', NULL, pm_id, pm_id),
    (p1, foundation_stage, 'PLAN', '2.1', NULL, '1.1.2', 'FS', 'Foundation works', 'Parent work package for foundation', 'lot', 1, 0, 'IN_PROGRESS', CURRENT_DATE - INTERVAL '10 days', CURRENT_DATE + INTERVAL '10 days', CURRENT_DATE - INTERVAL '9 days', NULL, pm_id, pm_id),
    (p1, foundation_stage, 'PLAN', '2.1.1', '2.1', NULL, NULL, 'Excavation', 'Excavate foundation pits', 'm3', 350, 0, 'DONE', CURRENT_DATE - INTERVAL '10 days', CURRENT_DATE - INTERVAL '5 days', CURRENT_DATE - INTERVAL '10 days', CURRENT_DATE - INTERVAL '4 days', pm_id, pm_id),
    (p1, foundation_stage, 'PLAN', '2.1.2', '2.1', '2.1.1', 'FS', 'Foundation concrete pouring', 'Concrete works for foundation', 'm3', 180, 0, 'IN_PROGRESS', CURRENT_DATE - INTERVAL '4 days', CURRENT_DATE + INTERVAL '4 days', CURRENT_DATE - INTERVAL '4 days', NULL, pm_id, pm_id),
    (p1, structure_stage, 'PLAN', '3.1', NULL, '2.1.2', 'FS', 'Ground floor structure', 'Columns, beams, and slab', 'lot', 1, 0, 'PLANNED', CURRENT_DATE + INTERVAL '5 days', CURRENT_DATE + INTERVAL '25 days', NULL, NULL, pm_id, pm_id),
    (p1, structure_stage, 'PLAN', '3.1.1', '3.1', NULL, NULL, 'Column formwork', 'Prepare formwork for ground floor columns', 'm2', 420, 0, 'PLANNED', CURRENT_DATE + INTERVAL '5 days', CURRENT_DATE + INTERVAL '10 days', NULL, NULL, pm_id, pm_id),
    (p1, finishing_stage, 'BOQ', '4.BOQ.1', NULL, NULL, NULL, 'Wall plastering quantity', 'Demo BOQ item without cost', 'm2', 1200, 0, 'PLANNED', CURRENT_DATE + INTERVAL '30 days', CURRENT_DATE + INTERVAL '45 days', NULL, NULL, pm_id, pm_id)
  ON CONFLICT DO NOTHING;

  SELECT id INTO task_111 FROM project_plan_boq_items WHERE project_id = p1 AND wbs_code = '1.1.1';
  SELECT id INTO task_112 FROM project_plan_boq_items WHERE project_id = p1 AND wbs_code = '1.1.2';
  SELECT id INTO task_211 FROM project_plan_boq_items WHERE project_id = p1 AND wbs_code = '2.1.1';
  SELECT id INTO task_212 FROM project_plan_boq_items WHERE project_id = p1 AND wbs_code = '2.1.2';
  SELECT id INTO task_311 FROM project_plan_boq_items WHERE project_id = p1 AND wbs_code = '3.1.1';

  INSERT INTO project_progress_updates (project_id, progress_percent, note, updated_by)
  SELECT p1, 15, 'Demo: project kicked off and site preparation started.', pm_id
  WHERE NOT EXISTS (SELECT 1 FROM project_progress_updates WHERE project_id = p1 AND note LIKE 'Demo:%');
  INSERT INTO project_progress_updates (project_id, progress_percent, note, updated_by)
  SELECT p1, 47, 'Demo: foundation is in progress; material usage and RFx are ready for review.', pm_id
  WHERE NOT EXISTS (SELECT 1 FROM project_progress_updates WHERE project_id = p1 AND progress_percent = 47);

  INSERT INTO project_assignments (user_id, project_id, assignment_role, assignment_status, shift_code, shift_start_time, shift_end_time, required_trade_code, assigned_by, work_start, work_end)
  SELECT u.id, p1,
         CASE WHEN u.trade_code = 'EQUIPMENT' THEN 'Equipment Operator' WHEN u.trade_code = 'WAREHOUSE' THEN 'Material Controller' ELSE 'Field Worker' END,
         'ACTIVE', 'DAY_SHIFT', TIME '07:00', TIME '17:00', u.trade_code, pm_id, CURRENT_DATE - INTERVAL '10 days', CURRENT_DATE + INTERVAL '30 days'
  FROM users u
  WHERE u.employee_code IN ('00000101','00000102','00000103','00000201','00000202','00000203','00000301','00000302','00000401','00000402','00000501','00000502','00000503','00000601','00000602')
  ON CONFLICT (user_id, project_id) DO UPDATE
  SET assignment_status = EXCLUDED.assignment_status,
      shift_code = EXCLUDED.shift_code,
      shift_start_time = EXCLUDED.shift_start_time,
      shift_end_time = EXCLUDED.shift_end_time,
      required_trade_code = EXCLUDED.required_trade_code,
      assigned_by = EXCLUDED.assigned_by,
      work_start = EXCLUDED.work_start,
      work_end = EXCLUDED.work_end;

  INSERT INTO project_assignments (user_id, project_id, assignment_role, assignment_status, shift_code, shift_start_time, shift_end_time, required_trade_code, assigned_by, work_start, work_end)
  SELECT u.id, p2, 'Fit-out Worker', 'ACTIVE', 'DAY_SHIFT', TIME '08:00', TIME '17:00', u.trade_code, pm_id, CURRENT_DATE - INTERVAL '5 days', CURRENT_DATE + INTERVAL '20 days'
  FROM users u
  WHERE u.employee_code IN ('00000403','00000404','00000504','00000603')
  ON CONFLICT (user_id, project_id) DO UPDATE
  SET assignment_status = EXCLUDED.assignment_status,
      required_trade_code = EXCLUDED.required_trade_code,
      work_start = EXCLUDED.work_start,
      work_end = EXCLUDED.work_end;

  INSERT INTO workforce_quota_requests (project_id, from_date, to_date, shift_code, trade_code, requested_count, status, created_by)
  VALUES
    (p1, CURRENT_DATE, CURRENT_DATE + INTERVAL '6 days', 'DAY_SHIFT', 'PREPARATION', 3, 'SUBMITTED', pm_id),
    (p1, CURRENT_DATE, CURRENT_DATE + INTERVAL '6 days', 'DAY_SHIFT', 'FOUNDATION', 4, 'SUBMITTED', pm_id),
    (p1, CURRENT_DATE, CURRENT_DATE + INTERVAL '6 days', 'DAY_SHIFT', 'STRUCTURE', 2, 'SUBMITTED', pm_id),
    (p1, CURRENT_DATE, CURRENT_DATE + INTERVAL '6 days', 'DAY_SHIFT', 'EQUIPMENT', 3, 'SUBMITTED', pm_id),
    (p2, CURRENT_DATE, CURRENT_DATE + INTERVAL '6 days', 'DAY_SHIFT', 'FINISHING', 5, 'SUBMITTED', pm_id),
    (p3, CURRENT_DATE + INTERVAL '12 days', CURRENT_DATE + INTERVAL '20 days', 'DAY_SHIFT', 'WAREHOUSE', 2, 'CANCELLED', pm_id)
  ON CONFLICT (project_id, from_date, to_date, shift_code, trade_code) DO UPDATE
  SET requested_count = EXCLUDED.requested_count,
      status = EXCLUDED.status,
      updated_at = NOW();

  FOR worker_id IN
    SELECT id FROM users WHERE employee_code IN ('00000101','00000102','00000201','00000202','00000301','00000501','00000601')
  LOOP
    INSERT INTO employee_work_schedules (user_id, project_id, shift_code, shift_name, shift_start_time, shift_end_time, work_date, status, created_by)
    VALUES (worker_id, p1, 'DAY_SHIFT', 'Day Shift', TIME '07:00', TIME '17:00', CURRENT_DATE, 'SCHEDULED', pm_id)
    ON CONFLICT (user_id, work_date, shift_code) DO UPDATE
    SET project_id = EXCLUDED.project_id,
        status = EXCLUDED.status,
        updated_at = NOW();
  END LOOP;

  FOR worker_id IN
    SELECT id FROM users WHERE employee_code IN ('00000101','00000201','00000301','00000401','00000501')
  LOOP
    INSERT INTO employee_work_schedules (user_id, project_id, shift_code, shift_name, shift_start_time, shift_end_time, work_date, status, created_by)
    VALUES (worker_id, p1, 'DAY_SHIFT', 'Day Shift', TIME '07:00', TIME '17:00', CURRENT_DATE - INTERVAL '1 day', 'COMPLETED', pm_id)
    ON CONFLICT (user_id, work_date, shift_code) DO UPDATE
    SET project_id = EXCLUDED.project_id,
        status = EXCLUDED.status,
        updated_at = NOW();
  END LOOP;

  FOR worker_id IN
    SELECT id FROM users WHERE employee_code IN ('00000103','00000202','00000601')
  LOOP
    INSERT INTO employee_work_schedules (user_id, project_id, shift_code, shift_name, shift_start_time, shift_end_time, work_date, status, created_by)
    VALUES (worker_id, p1, 'DAY_SHIFT', 'Day Shift', TIME '07:00', TIME '17:00', CURRENT_DATE - INTERVAL '2 days', 'COMPLETED', pm_id)
    ON CONFLICT (user_id, work_date, shift_code) DO UPDATE
    SET project_id = EXCLUDED.project_id,
        status = EXCLUDED.status,
        updated_at = NOW();
  END LOOP;

  FOR worker_id IN
    SELECT id FROM users WHERE employee_code IN ('00000602','00000504')
  LOOP
    INSERT INTO employee_work_schedules (user_id, project_id, shift_code, shift_name, shift_start_time, shift_end_time, work_date, status, created_by)
    VALUES (worker_id, p1, 'DAY_SHIFT', 'Day Shift', TIME '07:00', TIME '17:00', CURRENT_DATE - INTERVAL '3 days', 'COMPLETED', pm_id)
    ON CONFLICT (user_id, work_date, shift_code) DO UPDATE
    SET project_id = EXCLUDED.project_id,
        status = EXCLUDED.status,
        updated_at = NOW();
  END LOOP;

  INSERT INTO employee_work_schedules (user_id, project_id, shift_code, shift_name, shift_start_time, shift_end_time, work_date, status, created_by)
  SELECT u.id, p1, 'DAY_SHIFT', 'Day Shift', TIME '07:00', TIME '17:00', CURRENT_DATE - INTERVAL '3 days', 'LEAVE', pm_id
  FROM users u
  WHERE u.employee_code = '00000403'
  ON CONFLICT (user_id, work_date, shift_code) DO UPDATE
  SET project_id = EXCLUDED.project_id,
      status = EXCLUDED.status,
      updated_at = NOW();

  INSERT INTO attendance_logs (user_id, project_id, check_in_time, check_out_time, check_in_latitude, check_in_longitude, check_out_latitude, check_out_longitude, face_score, face_mode, liveness_score, is_within_geofence_in, is_within_geofence_out, gps_distance_in_m, gps_distance_out_m, attendance_status, note, captured_device)
  SELECT u.id, p1, CURRENT_DATE - INTERVAL '1 day' + TIME '06:55', CURRENT_DATE - INTERVAL '1 day' + TIME '17:05', 11.0713, 106.6849, 11.0713, 106.6849, 0.94, 'FACE_EMBEDDING', 0.9200, TRUE, TRUE, 18, 20, 'PRESENT', 'Demo present on time', 'mobile-ios'
  FROM users u WHERE u.employee_code = '00000101'
  UNION ALL
  SELECT u.id, p1, CURRENT_DATE - INTERVAL '1 day' + TIME '07:38', CURRENT_DATE - INTERVAL '1 day' + TIME '17:02', 11.0714, 106.6850, 11.0714, 106.6850, 0.88, 'FACE_EMBEDDING', 0.8500, TRUE, TRUE, 36, 35, 'LATE', 'Demo late arrival', 'mobile-android'
  FROM users u WHERE u.employee_code = '00000201'
  UNION ALL
  SELECT u.id, p1, CURRENT_DATE - INTERVAL '1 day' + TIME '06:58', CURRENT_DATE - INTERVAL '1 day' + TIME '15:10', 11.0713, 106.6849, 11.0713, 106.6849, 0.91, 'FACE_EMBEDDING', 0.8700, TRUE, TRUE, 24, 28, 'EARLY_LEAVE', 'Demo early leave', 'mobile-ios'
  FROM users u WHERE u.employee_code = '00000301'
  UNION ALL
  SELECT u.id, p1, CURRENT_DATE + TIME '07:08', NULL, 11.0713, 106.6849, NULL, NULL, 0.93, 'FACE_EMBEDDING', 0.9000, TRUE, NULL, 22, NULL, 'OPEN', 'Demo open check-in without checkout yet', 'mobile-android'
  FROM users u WHERE u.employee_code = '00000501'
  UNION ALL
  SELECT u.id, p1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'ABSENT', 'Demo absent worker', 'system'
  FROM users u WHERE u.employee_code = '00000401'
  UNION ALL
  SELECT u.id, p1, CURRENT_DATE - INTERVAL '2 days' + TIME '07:03', NULL, 11.0712, 106.6848, NULL, NULL, 0.90, 'FACE_EMBEDDING', 0.8800, TRUE, NULL, 16, NULL, 'MISSING_OUT', 'Demo MISSING_OUT: checked in but forgot checkout', 'mobile-android'
  FROM users u WHERE u.employee_code = '00000601'
  UNION ALL
  SELECT u.id, p1, CURRENT_DATE - INTERVAL '2 days' + TIME '06:50', CURRENT_DATE - INTERVAL '2 days' + TIME '19:30', 11.0712, 106.6848, 11.0712, 106.6848, 0.92, 'FACE_EMBEDDING', 0.9000, TRUE, TRUE, 19, 21, 'PRESENT', 'Demo OT: worked after 17:00 and requires overtime approval', 'mobile-ios'
  FROM users u WHERE u.employee_code = '00000202'
  UNION ALL
  SELECT u.id, p1, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, 'ON_LEAVE', 'Demo approved leave day', 'system'
  FROM users u WHERE u.employee_code = '00000103'
  UNION ALL
  SELECT u.id, p1, CURRENT_DATE - INTERVAL '3 days' + TIME '08:22', NULL, 11.0712, 106.6848, NULL, NULL, 0.89, 'FACE_EMBEDDING', 0.8600, TRUE, NULL, 30, NULL, 'MISSING_OUT', 'Demo late check-in + MISSING_OUT: arrived 08:22 and forgot checkout', 'mobile-android'
  FROM users u WHERE u.employee_code = '00000602'
  UNION ALL
  SELECT u.id, p1, CURRENT_DATE - INTERVAL '3 days' + TIME '07:10', CURRENT_DATE - INTERVAL '3 days' + TIME '20:15', 11.0712, 106.6848, 11.0712, 106.6848, 0.91, 'FACE_EMBEDDING', 0.8900, TRUE, TRUE, 18, 19, 'PRESENT', 'Demo late checkout OT: checked out 20:15 after approved extension', 'mobile-ios'
  FROM users u WHERE u.employee_code = '00000504'
  UNION ALL
  SELECT u.id, p1, CURRENT_DATE - INTERVAL '3 days' + TIME '13:15', CURRENT_DATE - INTERVAL '3 days' + TIME '17:45', 11.0712, 106.6848, 11.0712, 106.6848, 0.87, 'FACE_EMBEDDING', 0.8400, TRUE, TRUE, 20, 24, 'LATE', 'Demo half-day leave + late afternoon check-in', 'mobile-ios'
  FROM users u WHERE u.employee_code = '00000403';

  INSERT INTO requests (request_code, user_id, project_id, type, start_date, end_date, request_date, request_shift, hours, reason, status, approved_by, reviewer_note, approved_at, attachment_url, updated_at)
  SELECT 'REQ-DEMO-001', u.id, p1, 'leave', CURRENT_DATE + INTERVAL '2 days', CURRENT_DATE + INTERVAL '2 days', NULL, 'DAY_SHIFT', 8, 'Family event - demo pending leave request', 'PENDING', NULL, NULL, NULL, NULL, NOW()
  FROM users u WHERE u.employee_code = '00000102'
  ON CONFLICT (request_code) DO UPDATE SET status = EXCLUDED.status, reason = EXCLUDED.reason, updated_at = NOW();
  INSERT INTO requests (request_code, user_id, project_id, type, start_date, end_date, request_date, request_shift, hours, reason, status, approved_by, reviewer_note, approved_at, attachment_url, updated_at)
  SELECT 'REQ-DEMO-002', u.id, p1, 'overtime', CURRENT_DATE - INTERVAL '1 day', CURRENT_DATE - INTERVAL '1 day', NULL, 'DAY_SHIFT', 2, 'Concrete pouring extended after shift', 'APPROVED', hr_id, 'Approved for foundation concrete pour.', NOW() - INTERVAL '12 hours', NULL, NOW()
  FROM users u WHERE u.employee_code = '00000201'
  ON CONFLICT (request_code) DO UPDATE SET status = EXCLUDED.status, approved_by = EXCLUDED.approved_by, reviewer_note = EXCLUDED.reviewer_note, approved_at = EXCLUDED.approved_at, updated_at = NOW();
  INSERT INTO requests (request_code, user_id, project_id, type, start_date, end_date, request_date, request_shift, hours, reason, status, approved_by, reviewer_note, approved_at, attachment_url, updated_at)
  SELECT 'REQ-DEMO-003', u.id, p1, 'forgot_checkout', NULL, NULL, CURRENT_DATE - INTERVAL '1 day', 'DAY_SHIFT', NULL, 'Forgot checkout due to truck dispatch', 'REJECTED', hr_id, 'Rejected: attendance camera showed worker left early.', NOW() - INTERVAL '4 hours', NULL, NOW()
  FROM users u WHERE u.employee_code = '00000503'
  ON CONFLICT (request_code) DO UPDATE SET status = EXCLUDED.status, approved_by = EXCLUDED.approved_by, reviewer_note = EXCLUDED.reviewer_note, approved_at = EXCLUDED.approved_at, updated_at = NOW();
  INSERT INTO requests (request_code, user_id, project_id, type, start_date, end_date, request_date, request_shift, hours, reason, status, approved_by, reviewer_note, approved_at, attachment_url, updated_at)
  SELECT 'REQ-DEMO-004', u.id, p1, 'leave', CURRENT_DATE, CURRENT_DATE, NULL, 'DAY_SHIFT', 8, 'Medical appointment - demo approved leave request', 'APPROVED', hr_id, 'Approved as one full paid leave day.', NOW() - INTERVAL '2 hours', NULL, NOW()
  FROM users u WHERE u.employee_code = '00000103'
  ON CONFLICT (request_code) DO UPDATE SET status = EXCLUDED.status, approved_by = EXCLUDED.approved_by, reviewer_note = EXCLUDED.reviewer_note, approved_at = EXCLUDED.approved_at, updated_at = NOW();
  INSERT INTO requests (request_code, user_id, project_id, type, start_date, end_date, request_date, request_shift, hours, reason, status, approved_by, reviewer_note, approved_at, attachment_url, updated_at)
  SELECT 'REQ-DEMO-005', u.id, p1, 'leave', CURRENT_DATE + INTERVAL '1 day', CURRENT_DATE + INTERVAL '1 day', NULL, 'DAY_SHIFT', 4, 'Personal errand - demo rejected half-day leave', 'REJECTED', hr_id, 'Rejected because quota is short for foundation work.', NOW() - INTERVAL '1 hour', NULL, NOW()
  FROM users u WHERE u.employee_code = '00000203'
  ON CONFLICT (request_code) DO UPDATE SET status = EXCLUDED.status, approved_by = EXCLUDED.approved_by, reviewer_note = EXCLUDED.reviewer_note, approved_at = EXCLUDED.approved_at, updated_at = NOW();
  INSERT INTO requests (request_code, user_id, project_id, type, start_date, end_date, request_date, request_shift, hours, reason, status, approved_by, reviewer_note, approved_at, attachment_url, updated_at)
  SELECT 'REQ-DEMO-006', u.id, p1, 'overtime', CURRENT_DATE - INTERVAL '2 days', CURRENT_DATE - INTERVAL '2 days', NULL, 'DAY_SHIFT', 2.5, 'Worked until 19:30 for rebar preparation - pending OT approval', 'PENDING', NULL, NULL, NULL, NULL, NOW()
  FROM users u WHERE u.employee_code = '00000202'
  ON CONFLICT (request_code) DO UPDATE SET status = EXCLUDED.status, hours = EXCLUDED.hours, reason = EXCLUDED.reason, updated_at = NOW();
  INSERT INTO requests (request_code, user_id, project_id, type, start_date, end_date, request_date, request_shift, hours, reason, status, approved_by, reviewer_note, approved_at, attachment_url, updated_at)
  SELECT 'REQ-DEMO-007', u.id, p1, 'forgot_checkout', NULL, NULL, CURRENT_DATE - INTERVAL '2 days', 'DAY_SHIFT', NULL, 'Forgot checkout after material receiving handover - demo MISSING_OUT fix', 'PENDING', NULL, NULL, NULL, NULL, NOW()
  FROM users u WHERE u.employee_code = '00000601'
  ON CONFLICT (request_code) DO UPDATE SET status = EXCLUDED.status, reason = EXCLUDED.reason, updated_at = NOW();
  INSERT INTO requests (request_code, user_id, project_id, type, start_date, end_date, request_date, request_shift, hours, reason, status, approved_by, reviewer_note, approved_at, attachment_url, updated_at)
  SELECT 'REQ-DEMO-008', u.id, p1, 'forgot_checkout', NULL, NULL, CURRENT_DATE - INTERVAL '3 days', 'DAY_SHIFT', NULL, 'Late check-in at 08:22 and forgot checkout - demo MISSING_OUT pending correction', 'PENDING', NULL, NULL, NULL, NULL, NOW()
  FROM users u WHERE u.employee_code = '00000602'
  ON CONFLICT (request_code) DO UPDATE SET status = EXCLUDED.status, reason = EXCLUDED.reason, updated_at = NOW();
  INSERT INTO requests (request_code, user_id, project_id, type, start_date, end_date, request_date, request_shift, hours, reason, status, approved_by, reviewer_note, approved_at, attachment_url, updated_at)
  SELECT 'REQ-DEMO-009', u.id, p1, 'overtime', CURRENT_DATE - INTERVAL '3 days', CURRENT_DATE - INTERVAL '3 days', NULL, 'DAY_SHIFT', 3.25, 'Checked out at 20:15 after urgent material unloading - demo OT late checkout', 'APPROVED', hr_id, 'Approved because PM confirmed urgent unloading.', NOW() - INTERVAL '30 minutes', NULL, NOW()
  FROM users u WHERE u.employee_code = '00000504'
  ON CONFLICT (request_code) DO UPDATE SET status = EXCLUDED.status, hours = EXCLUDED.hours, approved_by = EXCLUDED.approved_by, reviewer_note = EXCLUDED.reviewer_note, approved_at = EXCLUDED.approved_at, updated_at = NOW();
  INSERT INTO requests (request_code, user_id, project_id, type, start_date, end_date, request_date, request_shift, hours, reason, status, approved_by, reviewer_note, approved_at, attachment_url, updated_at)
  SELECT 'REQ-DEMO-010', u.id, p1, 'leave', CURRENT_DATE - INTERVAL '3 days', CURRENT_DATE - INTERVAL '3 days', NULL, 'MORNING_HALF', 4, 'Approved morning half-day leave; worker checked in late afternoon at 13:15', 'APPROVED', hr_id, 'Approved half-day leave. Afternoon attendance kept for demo.', NOW() - INTERVAL '45 minutes', NULL, NOW()
  FROM users u WHERE u.employee_code = '00000403'
  ON CONFLICT (request_code) DO UPDATE SET status = EXCLUDED.status, hours = EXCLUDED.hours, approved_by = EXCLUDED.approved_by, reviewer_note = EXCLUDED.reviewer_note, approved_at = EXCLUDED.approved_at, updated_at = NOW();

  INSERT INTO timesheets
    (attendance_log_id, user_id, project_id, work_date, check_in_time, check_out_time, raw_work_hours, break_hours, actual_hours, working_day_value, ot_hours, timesheet_status, source, locked_by_request_id, notes, computed_at, updated_at)
  SELECT
    al.id, al.user_id, al.project_id, al.check_in_time::date, al.check_in_time, al.check_out_time,
    CASE WHEN al.check_out_time IS NOT NULL THEN ROUND((EXTRACT(EPOCH FROM (al.check_out_time - al.check_in_time)) / 3600)::numeric, 2) ELSE 0 END,
    CASE WHEN al.check_out_time IS NOT NULL THEN 1 ELSE 0 END,
    CASE WHEN al.check_out_time IS NOT NULL THEN GREATEST(ROUND((EXTRACT(EPOCH FROM (al.check_out_time - al.check_in_time)) / 3600)::numeric, 2) - 1, 0) ELSE 0 END,
    CASE WHEN al.attendance_status IN ('PRESENT', 'LATE', 'EARLY_LEAVE') THEN 1 ELSE 0 END,
    CASE
      WHEN al.note LIKE 'Demo OT:%' THEN 2.5
      WHEN al.note LIKE 'Demo late checkout OT:%' THEN 3.25
      ELSE 0
    END,
    CASE
      WHEN al.attendance_status = 'MISSING_OUT' THEN 'MISSING_OUT'
      WHEN al.note LIKE 'Demo OT:%' THEN 'PENDING_OT_APPROVAL'
      WHEN al.note LIKE 'Demo late checkout OT:%' THEN 'APPROVED_OT'
      WHEN al.note LIKE 'Demo half-day leave%' THEN 'ON_LEAVE'
      ELSE al.attendance_status
    END,
    'DEMO',
    CASE
      WHEN al.note LIKE 'Demo OT:%' THEN (SELECT id FROM requests WHERE request_code = 'REQ-DEMO-006')
      WHEN al.note LIKE 'Demo late checkout OT:%' THEN (SELECT id FROM requests WHERE request_code = 'REQ-DEMO-009')
      WHEN al.note LIKE 'Demo half-day leave%' THEN (SELECT id FROM requests WHERE request_code = 'REQ-DEMO-010')
      ELSE NULL
    END,
    al.note,
    NOW(),
    NOW()
  FROM attendance_logs al
  WHERE al.project_id = p1
    AND al.note IN (
      'Demo present on time',
      'Demo late arrival',
      'Demo early leave',
      'Demo MISSING_OUT: checked in but forgot checkout',
      'Demo OT: worked after 17:00 and requires overtime approval',
      'Demo late check-in + MISSING_OUT: arrived 08:22 and forgot checkout',
      'Demo late checkout OT: checked out 20:15 after approved extension',
      'Demo half-day leave + late afternoon check-in'
    )
  ON CONFLICT (attendance_log_id) DO UPDATE
  SET check_in_time = EXCLUDED.check_in_time,
      check_out_time = EXCLUDED.check_out_time,
      raw_work_hours = EXCLUDED.raw_work_hours,
      break_hours = EXCLUDED.break_hours,
      actual_hours = EXCLUDED.actual_hours,
      working_day_value = EXCLUDED.working_day_value,
      ot_hours = EXCLUDED.ot_hours,
      timesheet_status = EXCLUDED.timesheet_status,
      locked_by_request_id = EXCLUDED.locked_by_request_id,
      notes = EXCLUDED.notes,
      updated_at = NOW();

  INSERT INTO timesheets
    (attendance_log_id, user_id, project_id, work_date, check_in_time, check_out_time, raw_work_hours, break_hours, actual_hours, working_day_value, ot_hours, timesheet_status, source, locked_by_request_id, notes, computed_at, updated_at)
  SELECT
    NULL, u.id, p1, CURRENT_DATE, NULL, NULL, 0, 0, 0, 1, 0, 'ON_LEAVE', 'REQUEST', r.id,
    'Demo leave timesheet locked by approved leave request REQ-DEMO-004.',
    NOW(), NOW()
  FROM users u
  JOIN requests r ON r.request_code = 'REQ-DEMO-004'
  WHERE u.employee_code = '00000103';

  INSERT INTO project_material_logs (project_id, material_name, unit, planned_qty, received_qty, used_qty, unit_cost, supplier, status, note, created_by, updated_by)
  VALUES
    (p1, 'Sand', 'm3', 420, 430, 360, 230000, 'Binh Duong Aggregate Co.', 'OVER_RECEIVED', 'Demo over-import warning: received quantity exceeds plan.', pm_id, pm_id),
    (p1, 'Cement PCB40', 'bag', 1500, 1200, 980, 92000, 'VietBuild Materials', 'IN_STOCK', 'Fast-moving material for foundation concrete.', pm_id, pm_id),
    (p1, 'Steel rebar D16', 'kg', 18000, 16000, 18500, 18500, 'Southern Steel', 'OVER_USED', 'Demo over-usage warning: used quantity exceeds plan.', pm_id, pm_id),
    (p1, 'Formwork plywood', 'sheet', 600, 350, 340, 315000, 'Phu My Formwork', 'LOW_STOCK', 'Low stock demo item.', pm_id, pm_id),
    (p2, 'Paint primer', 'liter', 900, 400, 120, 68000, 'Saigon Paint', 'IN_STOCK', 'Fit-out project inventory.', pm_id, pm_id)
  ON CONFLICT DO NOTHING;

  SELECT id INTO sand_id FROM project_material_logs WHERE project_id = p1 AND material_name = 'Sand' ORDER BY id DESC LIMIT 1;
  SELECT id INTO cement_id FROM project_material_logs WHERE project_id = p1 AND material_name = 'Cement PCB40' ORDER BY id DESC LIMIT 1;
  SELECT id INTO steel_id FROM project_material_logs WHERE project_id = p1 AND material_name = 'Steel rebar D16' ORDER BY id DESC LIMIT 1;

  INSERT INTO project_daily_material_usage (project_id, material_id, stage_id, usage_date, used_qty, wbs_code, note, created_by, updated_by)
  VALUES
    (p1, sand_id, foundation_stage, CURRENT_DATE - INTERVAL '1 day', 32, '2.1.2', 'Used for foundation concrete batch 01.', pm_id, pm_id),
    (p1, cement_id, foundation_stage, CURRENT_DATE - INTERVAL '1 day', 140, '2.1.2', 'Daily concrete pouring usage.', pm_id, pm_id),
    (p1, steel_id, structure_stage, CURRENT_DATE, 850, '3.1.1', 'Early steel preparation for column formwork.', pm_id, pm_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO project_cost_entries (project_id, category, description, amount, incurred_on, status, created_by, updated_by)
  VALUES
    (p1, 'MATERIAL', 'Cement purchase batch demo', 110400000, CURRENT_DATE - INTERVAL '3 days', 'APPROVED', pm_id, pm_id),
    (p1, 'LABOR', 'Weekly labor payment demo', 78000000, CURRENT_DATE - INTERVAL '2 days', 'DRAFT', pm_id, pm_id),
    (p1, 'EQUIPMENT', 'Excavator rental and fuel', 26500000, CURRENT_DATE - INTERVAL '1 day', 'PAID', pm_id, pm_id),
    (p1, 'TRANSPORT', 'Material transport from supplier', 9800000, CURRENT_DATE - INTERVAL '1 day', 'APPROVED', pm_id, pm_id),
    (p1, 'SAFETY', 'Safety signage and PPE refresh', 6200000, CURRENT_DATE, 'DRAFT', pm_id, pm_id),
    (p1, 'OTHER', 'Temporary site utilities', 4500000, CURRENT_DATE, 'DRAFT', pm_id, pm_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO project_resource_allocations (project_id, resource_type, resource_name, quantity, unit, hourly_rate, working_hours, status, note, created_by, updated_by)
  VALUES
    (p1, 'LABOR', 'Foundation workforce', 8, 'person', 48000, 80, 'ACTIVE', 'Demo labor allocation.', pm_id, pm_id),
    (p1, 'EQUIPMENT', 'Excavator 1.2m3', 1, 'unit', 450000, 24, 'ACTIVE', 'Demo equipment allocation.', pm_id, pm_id),
    (p1, 'EQUIPMENT', 'Dump truck', 2, 'unit', 300000, 16, 'ACTIVE', 'Demo truck allocation.', pm_id, pm_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO project_equipment_assets (project_id, license_plate, equipment_type, brand, model, vin_no, engine_no, fuel_type, ownership_type, driver_name, driver_code, driver_phone, rental_vendor, status, note, created_by, updated_by)
  SELECT p1, 'BD-EX-001', 'Excavator', 'Komatsu', 'PC200-8', 'VIN-DEMO-EX-001', 'ENG-DEMO-EX-001', 'DIESEL', 'RENTED', u.full_name, u.employee_code, u.phone, 'Binh Duong Heavy Equipment', 'ACTIVE', 'Demo equipment with operator allocated by quota/schedule.', pm_id, pm_id
  FROM users u WHERE u.employee_code = '00000502'
  ON CONFLICT DO NOTHING
  RETURNING id INTO equipment_asset_id;

  IF equipment_asset_id IS NULL THEN
    SELECT id INTO equipment_asset_id FROM project_equipment_assets WHERE project_id = p1 AND license_plate = 'BD-EX-001' ORDER BY id DESC LIMIT 1;
  END IF;

  INSERT INTO project_equipment_assets (project_id, license_plate, equipment_type, brand, model, vin_no, engine_no, fuel_type, ownership_type, driver_name, driver_code, driver_phone, rental_vendor, status, note, created_by, updated_by)
  SELECT p1, 'BD-TR-002', 'Dump Truck', 'Hino', 'FM8JN7A', 'VIN-DEMO-TR-002', 'ENG-DEMO-TR-002', 'DIESEL', 'OWNED', u.full_name, u.employee_code, u.phone, NULL, 'MAINTENANCE', 'Demo asset under maintenance.', pm_id, pm_id
  FROM users u WHERE u.employee_code = '00000503'
  ON CONFLICT DO NOTHING;

  INSERT INTO project_equipment_logs (project_id, equipment_id, log_type, log_date, title, description, trip_count, distance_km, fuel_liters, odometer_km, cost_amount, status, created_by, updated_by)
  VALUES
    (p1, equipment_asset_id, 'TRIP_SHIFT', CURRENT_DATE - INTERVAL '1 day', 'Excavation shift operation', 'Moved excavated soil to temporary stockpile.', 9, 22.5, 68, 12850, 2800000, 'COMPLETED', pm_id, pm_id),
    (p1, equipment_asset_id, 'FUEL', CURRENT_DATE, 'Fuel refill', 'Diesel refill for excavator.', NULL, NULL, 120, 12870, 2400000, 'APPROVED', pm_id, pm_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO project_construction_diaries (project_id, task_id, diary_code, diary_date, title, work_content, issues, weather, weather_morning, weather_afternoon, weather_evening, weather_night, site_condition, temperature, incident_report, safety_rating, quality_rating, progress_rating, hygiene_rating, proposal, report_watchers, note, status, created_by, updated_by)
  VALUES
    (p1, task_212, 'DIARY-DEMO-001', CURRENT_DATE - INTERVAL '1 day', 'Foundation concrete pouring diary', 'Completed concrete pouring for foundation zone A with 8 workers and 1 excavator support.', 'Minor delay due to cement delivery queue.', 'Sunny', 'Sunny', 'Hot', 'Cloudy', 'Cool', 'Dry site, access road stable.', '31C', 'No incident.', 'GOOD', 'GOOD', 'ON_TRACK', 'GOOD', 'Coordinate cement delivery one hour earlier tomorrow.', 'Project Manager, HR Manager', 'Demo diary linked to WBS 2.1.2.', 'OPEN', pm_id, pm_id),
    (p1, task_112, 'DIARY-DEMO-002', CURRENT_DATE - INTERVAL '5 days', 'Site clearing completion', 'Cleared temporary obstacles and marked storage area.', NULL, 'Light rain', 'Cloudy', 'Light rain', 'Cloudy', 'Cool', 'Some wet soil near gate B.', '28C', 'Near miss: truck reversed without spotter.', 'WARNING', 'GOOD', 'DELAYED', 'FAIR', 'Add spotter for reverse truck movement.', 'Site Supervisor', 'Demo diary with safety issue.', 'REVIEW', pm_id, pm_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO project_rfx_records (project_id, task_id, rfx_type, title, priority, status, requested_by, due_date, resolved_on, description, created_by, updated_by)
  VALUES
    (p1, task_212, 'RFI', 'Clarify concrete slump requirement for foundation zone A', 'HIGH', 'OPEN', 'Project Manager', CURRENT_DATE + INTERVAL '2 days', NULL, 'Site team needs confirmation before next concrete batch.', pm_id, pm_id),
    (p1, task_311, 'SUBMITTAL', 'Submit shop drawing for column formwork', 'NORMAL', 'SUBMITTED', 'Site Supervisor', CURRENT_DATE + INTERVAL '5 days', NULL, 'Formwork vendor drawing package for review.', sup_id, sup_id),
    (p1, task_112, 'ISSUE', 'Truck reversing near miss at gate B', 'CRITICAL', 'RESOLVED', 'Site Supervisor', CURRENT_DATE - INTERVAL '2 days', CURRENT_DATE - INTERVAL '1 day', 'Resolved by adding banksman control and warning zone.', sup_id, pm_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO project_acceptance_records (project_id, title, phase, accepted_by, accepted_on, status, note, created_by, updated_by)
  VALUES
    (p1, 'Excavation acceptance zone A', 'Foundation Construction', 'Project Manager / Site Supervisor', CURRENT_DATE - INTERVAL '4 days', 'APPROVED', 'Demo approved acceptance record.', pm_id, pm_id),
    (p1, 'Foundation concrete acceptance zone A', 'Foundation Construction', NULL, NULL, 'PENDING', 'Demo pending acceptance.', pm_id, pm_id),
    (p4, 'Final handover acceptance', 'Acceptance', 'Client Representative', CURRENT_DATE - INTERVAL '3 days', 'APPROVED', 'Completed project demo.', pm_id, pm_id)
  ON CONFLICT DO NOTHING;

  INSERT INTO salary_month_settings (month, year, standard_working_days, updated_by)
  VALUES (EXTRACT(MONTH FROM CURRENT_DATE)::int, EXTRACT(YEAR FROM CURRENT_DATE)::int, 26, hr_id)
  ON CONFLICT (month, year) DO UPDATE
  SET standard_working_days = EXCLUDED.standard_working_days,
      updated_by = EXCLUDED.updated_by,
      updated_at = NOW();

  INSERT INTO holidays (holiday_date, holiday_name, multiplier, is_active)
  VALUES
    (CURRENT_DATE + INTERVAL '10 days', 'Demo Company Safety Day', 2.00, TRUE),
    (CURRENT_DATE + INTERVAL '25 days', 'Demo Local Holiday', 1.50, TRUE)
  ON CONFLICT (holiday_date) DO UPDATE
  SET holiday_name = EXCLUDED.holiday_name,
      multiplier = EXCLUDED.multiplier,
      is_active = EXCLUDED.is_active,
      updated_at = NOW();

  INSERT INTO salaries (user_id, month, year, base_salary, overtime_hours, overtime_rate, bonus, deductions, total_salary, payment_date, status, notes)
  SELECT u.id, EXTRACT(MONTH FROM CURRENT_DATE)::int, EXTRACT(YEAR FROM CURRENT_DATE)::int, u.base_monthly_salary, 8, u.hourly_rate * 1.5, 500000, 100000,
         u.base_monthly_salary + (8 * u.hourly_rate * 1.5) + 500000 - 100000, NULL, 'PENDING', 'Demo payroll pending finalization.'
  FROM users u
  WHERE u.employee_code IN ('00000101','00000201','00000301','00000401','00000501')
  ON CONFLICT (user_id, month, year) DO UPDATE
  SET base_salary = EXCLUDED.base_salary,
      overtime_hours = EXCLUDED.overtime_hours,
      overtime_rate = EXCLUDED.overtime_rate,
      bonus = EXCLUDED.bonus,
      deductions = EXCLUDED.deductions,
      total_salary = EXCLUDED.total_salary,
      status = EXCLUDED.status,
      notes = EXCLUDED.notes,
      updated_at = NOW();

  INSERT INTO notifications (user_id, sender_user_id, notification_type, priority, title, message, action_url, status, read_at)
  SELECT u.id, pm_id, 'WORKFORCE_ASSIGNMENT', 'HIGH', 'Assigned to Binh Duong Warehouse Expansion', 'You have been assigned to PRJ-DEMO-001 for the day shift.', '/employee/attendance', 'UNREAD', NULL
  FROM users u WHERE u.employee_code IN ('00000101','00000201','00000501')
  UNION ALL
  SELECT u.id, hr_id, 'REQUEST_APPROVAL', 'NORMAL', 'Overtime request approved', 'Your overtime request REQ-DEMO-002 has been approved.', '/employee/requests', 'READ', NOW() - INTERVAL '1 hour'
  FROM users u WHERE u.employee_code = '00000201'
  UNION ALL
  SELECT pm_id, hr_id, 'FACE_ENROLLMENT', 'NORMAL', 'Face enrollment pending review', 'Several workers have pending face enrollment samples.', '/users/face-status', 'UNREAD', NULL
  ON CONFLICT DO NOTHING;

  INSERT INTO data_logs (service_name, action, collection, record_id, username, metadata)
  VALUES
    ('demo-seed', 'seed', 'database', '02_demo_seed', 'system', jsonb_build_object('projects', 4, 'workers', 30, 'note', 'Comprehensive demo data')),
    ('auth-service', 'login', 'auth', pm_id::text, 'manager@mdp.local', jsonb_build_object('demo', true)),
    ('project-service', 'create', 'project_rfx_records', 'RFX-DEMO', 'manager@mdp.local', jsonb_build_object('demo', true))
  ON CONFLICT DO NOTHING;
END $$;

COMMIT;
