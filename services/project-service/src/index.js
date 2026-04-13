require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();
const port = Number(process.env.PROJECT_SERVICE_PORT || 3003);

const pool = new Pool({
  host: process.env.POSTGRES_HOST || "localhost",
  port: Number(process.env.POSTGRES_PORT || 6543),
  database: process.env.POSTGRES_DB || "mdp_system",
  user: process.env.POSTGRES_USER || "mdp_user",
  password: process.env.POSTGRES_PASSWORD || "mdp_password"
});

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "change_access_secret";
const TOKEN_ISSUER = process.env.TOKEN_ISSUER || "mdp-system";
const BODY_LIMIT = process.env.PROJECT_BODY_LIMIT || "15mb";

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: BODY_LIMIT }));

const DEFAULT_STAGE_TEMPLATES = [
  "Preparation",
  "Foundation Construction",
  "Structure Construction",
  "Finishing",
  "Acceptance"
];
const STAGE_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "COMPLETED"];

async function normalizeProjectStageOrder(projectId, db = pool) {
  await db.query(
    `WITH ordered AS (
       SELECT id, ROW_NUMBER() OVER (ORDER BY stage_order, id) AS next_order
       FROM project_stages
       WHERE project_id = $1
     )
     UPDATE project_stages ps
     SET stage_order = ordered.next_order,
         updated_at = NOW()
     FROM ordered
     WHERE ps.id = ordered.id`,
    [projectId]
  );
}

async function enforceSequentialStageLocks(projectId, db = pool) {
  await normalizeProjectStageOrder(projectId, db);

  await db.query(
    `WITH ordered AS (
       SELECT
         id,
         CASE
           WHEN stage_order = 1 THEN FALSE
           WHEN LAG(status) OVER (ORDER BY stage_order, id) = 'COMPLETED' THEN FALSE
           ELSE TRUE
         END AS next_locked
       FROM project_stages
       WHERE project_id = $1
       ORDER BY stage_order, id
     )
     UPDATE project_stages ps
     SET is_locked = ordered.next_locked,
         updated_at = NOW()
     FROM ordered
     WHERE ps.id = ordered.id`,
    [projectId]
  );
}

async function seedDefaultStageTemplates(db = pool) {
  const existing = await db.query("SELECT COUNT(*)::int AS total FROM project_stage_templates");
  if (existing.rows[0].total > 0) {
    return;
  }

  const insertQuery = `
    INSERT INTO project_stage_templates (stage_name, default_order)
    VALUES ${DEFAULT_STAGE_TEMPLATES.map((_, index) => `($${index * 2 + 1}, $${index * 2 + 2})`).join(",")}
  `;
  const values = DEFAULT_STAGE_TEMPLATES.flatMap((name, index) => [name, index + 1]);
  await db.query(insertQuery, values);
}

async function initializeProjectStages(projectId, db = pool) {
  await db.query(
    `WITH ordered_templates AS (
       SELECT t.id, t.stage_name, ROW_NUMBER() OVER (ORDER BY t.default_order, t.id) AS stage_order
       FROM project_stage_templates t
     )
     INSERT INTO project_stages
       (project_id, stage_name, stage_order, created_from_template_id, progress_percent, status, is_locked, weight)
     SELECT
       $1,
       ot.stage_name,
       ot.stage_order,
       ot.id,
       0,
       'NOT_STARTED',
       CASE WHEN ot.stage_order = 1 THEN FALSE ELSE TRUE END,
       1
     FROM ordered_templates ot
     ORDER BY ot.stage_order`,
    [projectId]
  );
}

async function recalculateProjectProgress(projectId, db = pool) {
  const stageResult = await db.query(
    `SELECT progress_percent, COALESCE(weight, 1) AS weight, status
     FROM project_stages
     WHERE project_id = $1
     ORDER BY stage_order, id`,
    [projectId]
  );

  if (stageResult.rowCount === 0) {
    await db.query(
      `UPDATE projects
       SET progress_percent = 0,
           updated_at = NOW()
       WHERE id = $1`,
      [projectId]
    );
    return { progressPercent: 0, projectStatus: "PLANNING" };
  }

  const totalWeight = stageResult.rows.reduce((sum, row) => sum + Number(row.weight || 1), 0) || stageResult.rowCount;
  const weightedProgress = stageResult.rows.reduce(
    (sum, row) => sum + Number(row.progress_percent || 0) * Number(row.weight || 1),
    0
  );
  const progressPercent = Math.round((weightedProgress / totalWeight) * 100) / 100;

  const allCompleted = stageResult.rows.every((row) => row.status === "COMPLETED");
  const anyStarted = stageResult.rows.some((row) => row.status === "IN_PROGRESS" || Number(row.progress_percent || 0) > 0);
  const projectStatus = allCompleted ? "COMPLETED" : anyStarted ? "IN_PROGRESS" : "PLANNING";

  await db.query(
    `UPDATE projects
     SET progress_percent = $1,
         status = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [progressPercent, projectStatus, projectId]
  );

  return { progressPercent, projectStatus };
}

async function syncStageProgressFromTasks(projectId, db = pool) {
  await db.query(
    `WITH task_stats AS (
       SELECT
         stage_id,
         COUNT(*)::int AS total_tasks,
         COUNT(*) FILTER (
           WHERE UPPER(COALESCE(status, '')) IN ('DONE', 'COMPLETED')
              OR actual_end_date IS NOT NULL
         )::int AS completed_tasks,
         COUNT(*) FILTER (
           WHERE UPPER(COALESCE(status, '')) IN ('IN_PROGRESS', 'DONE', 'COMPLETED')
              OR actual_date IS NOT NULL
              OR actual_end_date IS NOT NULL
         )::int AS started_tasks
       FROM project_plan_boq_items
       WHERE project_id = $1
         AND stage_id IS NOT NULL
       GROUP BY stage_id
     )
     UPDATE project_stages ps
     SET
       progress_percent = CASE
         WHEN COALESCE(ts.total_tasks, 0) = 0 THEN 0
         ELSE ROUND((COALESCE(ts.completed_tasks, 0)::numeric / ts.total_tasks::numeric) * 100)::int
       END,
       status = CASE
         WHEN COALESCE(ts.total_tasks, 0) = 0 THEN 'NOT_STARTED'
         WHEN COALESCE(ts.completed_tasks, 0) >= ts.total_tasks THEN 'COMPLETED'
         WHEN COALESCE(ts.started_tasks, 0) > 0 THEN 'IN_PROGRESS'
         ELSE 'NOT_STARTED'
       END,
       started_at = CASE
         WHEN COALESCE(ts.total_tasks, 0) > 0 AND COALESCE(ts.started_tasks, 0) > 0 AND ps.started_at IS NULL THEN NOW()
         WHEN COALESCE(ts.total_tasks, 0) = 0 OR COALESCE(ts.started_tasks, 0) = 0 THEN NULL
         ELSE ps.started_at
       END,
       completed_at = CASE
         WHEN COALESCE(ts.total_tasks, 0) > 0 AND COALESCE(ts.completed_tasks, 0) >= ts.total_tasks THEN COALESCE(ps.completed_at, NOW())
         ELSE NULL
       END,
       updated_at = NOW()
     FROM task_stats ts
     WHERE ps.project_id = $1
       AND ps.id = ts.stage_id`,
    [projectId]
  );

  await db.query(
    `UPDATE project_stages
     SET progress_percent = 0,
         status = 'NOT_STARTED',
         started_at = NULL,
         completed_at = NULL,
         updated_at = NOW()
     WHERE project_id = $1
       AND id NOT IN (
         SELECT DISTINCT stage_id
         FROM project_plan_boq_items
         WHERE project_id = $1
           AND stage_id IS NOT NULL
       )`,
    [projectId]
  );
}

async function syncProjectProgressFromStageTasks(projectId, db = pool) {
  await syncStageProgressFromTasks(projectId, db);
  await enforceSequentialStageLocks(projectId, db);
  await recalculateProjectProgress(projectId, db);
}

function calculateDurationDays(startDate, endDate) {
  if (!startDate) {
    return 0;
  }
  const start = new Date(startDate);
  const end = new Date(endDate || startDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return 0;
  }
  const diff = Math.ceil((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));
  return Math.max(1, diff + 1);
}

function isTaskCompleted(task) {
  const status = String(task.status || "").toUpperCase();
  return status === "DONE" || status === "COMPLETED" || Boolean(task.actual_end_date);
}

async function syncProjectProgressFromTasks(projectId, mode = "points", db = pool) {
  const taskResult = await db.query(
    `SELECT quantity, status, planned_date, planned_end_date, actual_end_date
     FROM project_plan_boq_items
     WHERE project_id = $1`,
    [projectId]
  );

  const tasks = taskResult.rows;
  if (tasks.length === 0) {
    await db.query(
      `UPDATE projects
       SET progress_percent = 0,
           status = 'PLANNING',
           updated_at = NOW()
       WHERE id = $1`,
      [projectId]
    );
    return { progressPercent: 0, projectStatus: "PLANNING", totalTasks: 0, completedTasks: 0, mode: "points" };
  }

  const normalizedMode = String(mode || "points").toLowerCase() === "duration" ? "duration" : "points";
  let progressPercent = 0;

  if (normalizedMode === "duration") {
    const totalDuration = tasks.reduce(
      (sum, task) => sum + calculateDurationDays(task.planned_date, task.planned_end_date),
      0
    );
    const completedDuration = tasks
      .filter((task) => isTaskCompleted(task))
      .reduce((sum, task) => sum + calculateDurationDays(task.planned_date, task.planned_end_date), 0);
    progressPercent = totalDuration > 0 ? (completedDuration / totalDuration) * 100 : 0;
  } else {
    const totalPoints = tasks.reduce((sum, task) => sum + Math.max(1, Number(task.quantity || 0)), 0);
    const completedPoints = tasks
      .filter((task) => isTaskCompleted(task))
      .reduce((sum, task) => sum + Math.max(1, Number(task.quantity || 0)), 0);
    progressPercent = totalPoints > 0 ? (completedPoints / totalPoints) * 100 : 0;
  }

  const rounded = Math.max(0, Math.min(100, Math.round(progressPercent * 100) / 100));
  const projectStatus = rounded >= 100 ? "COMPLETED" : rounded > 0 ? "IN_PROGRESS" : "PLANNING";

  await db.query(
    `UPDATE projects
     SET progress_percent = $1,
         status = $2,
         updated_at = NOW()
     WHERE id = $3`,
    [rounded, projectStatus, projectId]
  );

  const completedTasks = tasks.filter((task) => isTaskCompleted(task)).length;
  return {
    progressPercent: rounded,
    projectStatus,
    totalTasks: tasks.length,
    completedTasks,
    mode: normalizedMode
  };
}

async function ensureConstructionTables() {
  await pool.query("ALTER TABLE projects ADD COLUMN IF NOT EXISTS progress_percent NUMERIC(6,2) NOT NULL DEFAULT 0");

  await pool.query(
    `CREATE TABLE IF NOT EXISTS project_plan_boq_items (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      stage_id INTEGER REFERENCES project_stages(id) ON DELETE SET NULL,
      item_type VARCHAR(20) NOT NULL DEFAULT 'PLAN' CHECK (item_type IN ('PLAN', 'BOQ')),
      wbs_code VARCHAR(80),
      parent_wbs_code VARCHAR(80),
      dependency_wbs_code VARCHAR(80),
      dependency_type VARCHAR(20),
      item_name VARCHAR(255) NOT NULL,
      description TEXT,
      unit VARCHAR(40),
      quantity NUMERIC(14,2) NOT NULL DEFAULT 0,
      unit_cost NUMERIC(14,2) NOT NULL DEFAULT 0,
      status VARCHAR(30) NOT NULL DEFAULT 'PLANNED',
      planned_date DATE,
      planned_end_date DATE,
      actual_date DATE,
      actual_end_date DATE,
      created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS project_material_logs (
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
    )`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS project_resource_allocations (
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
    )`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS project_equipment_assets (
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
    )`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS project_equipment_logs (
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
    )`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS project_cost_entries (
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
    )`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS project_budget_plans (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
      planned_budget NUMERIC(14,2) NOT NULL DEFAULT 0,
      planned_disbursement NUMERIC(14,2) NOT NULL DEFAULT 0,
      planned_revenue NUMERIC(14,2) NOT NULL DEFAULT 0,
      note TEXT,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS project_budget_vouchers (
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
    )`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS project_acceptance_records (
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
    )`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS project_construction_diaries (
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
    )`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS project_rfx_records (
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
    )`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS project_stage_templates (
      id SERIAL PRIMARY KEY,
      stage_name VARCHAR(255) NOT NULL,
      default_order INTEGER NOT NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS project_stages (
      id SERIAL PRIMARY KEY,
      project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
      stage_name VARCHAR(255) NOT NULL,
      stage_order INTEGER NOT NULL,
      created_from_template_id INTEGER REFERENCES project_stage_templates(id) ON DELETE SET NULL,
      progress_percent INTEGER NOT NULL DEFAULT 0 CHECK (progress_percent BETWEEN 0 AND 100),
      status VARCHAR(20) NOT NULL DEFAULT 'NOT_STARTED' CHECK (status IN ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED')),
      is_locked BOOLEAN NOT NULL DEFAULT FALSE,
      weight NUMERIC(8,2) NOT NULL DEFAULT 1,
      started_at TIMESTAMP,
      completed_at TIMESTAMP,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`
  );

  await pool.query(
    `CREATE TABLE IF NOT EXISTS project_stage_assignments (
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
    )`
  );

  await pool.query("CREATE INDEX IF NOT EXISTS idx_project_stage_assignments_project_stage ON project_stage_assignments(project_id, stage_id)");

  await pool.query("ALTER TABLE project_stages ADD COLUMN IF NOT EXISTS progress_percent INTEGER NOT NULL DEFAULT 0");
  await pool.query("ALTER TABLE project_stages ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'NOT_STARTED'");
  await pool.query("ALTER TABLE project_stages ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE");
  await pool.query("ALTER TABLE project_stages ADD COLUMN IF NOT EXISTS weight NUMERIC(8,2) NOT NULL DEFAULT 1");
  await pool.query("ALTER TABLE project_stages ADD COLUMN IF NOT EXISTS started_at TIMESTAMP");
  await pool.query("ALTER TABLE project_stages ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP");
  await pool.query("ALTER TABLE project_stages ADD COLUMN IF NOT EXISTS updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL");
  await pool.query("ALTER TABLE project_plan_boq_items ADD COLUMN IF NOT EXISTS stage_id INTEGER REFERENCES project_stages(id) ON DELETE SET NULL");
  await pool.query("ALTER TABLE project_plan_boq_items ADD COLUMN IF NOT EXISTS wbs_code VARCHAR(80)");
  await pool.query("ALTER TABLE project_plan_boq_items ADD COLUMN IF NOT EXISTS parent_wbs_code VARCHAR(80)");
  await pool.query("ALTER TABLE project_plan_boq_items ADD COLUMN IF NOT EXISTS dependency_wbs_code VARCHAR(80)");
  await pool.query("ALTER TABLE project_plan_boq_items ADD COLUMN IF NOT EXISTS dependency_type VARCHAR(20)");
  await pool.query("ALTER TABLE project_plan_boq_items ADD COLUMN IF NOT EXISTS planned_end_date DATE");
  await pool.query("ALTER TABLE project_plan_boq_items ADD COLUMN IF NOT EXISTS actual_end_date DATE");
  await pool.query("ALTER TABLE project_equipment_assets ADD COLUMN IF NOT EXISTS license_plate VARCHAR(120)");
  await pool.query("ALTER TABLE project_equipment_assets ADD COLUMN IF NOT EXISTS equipment_type VARCHAR(120)");
  await pool.query("ALTER TABLE project_equipment_assets ADD COLUMN IF NOT EXISTS brand VARCHAR(120)");
  await pool.query("ALTER TABLE project_equipment_assets ADD COLUMN IF NOT EXISTS model VARCHAR(120)");
  await pool.query("ALTER TABLE project_equipment_assets ADD COLUMN IF NOT EXISTS vin_no VARCHAR(120)");
  await pool.query("ALTER TABLE project_equipment_assets ADD COLUMN IF NOT EXISTS engine_no VARCHAR(120)");
  await pool.query("ALTER TABLE project_equipment_assets ADD COLUMN IF NOT EXISTS fuel_type VARCHAR(60)");
  await pool.query("ALTER TABLE project_equipment_assets ADD COLUMN IF NOT EXISTS ownership_type VARCHAR(60) DEFAULT 'OWNED'");
  await pool.query("ALTER TABLE project_equipment_assets ADD COLUMN IF NOT EXISTS driver_name VARCHAR(160)");
  await pool.query("ALTER TABLE project_equipment_assets ADD COLUMN IF NOT EXISTS driver_code VARCHAR(80)");
  await pool.query("ALTER TABLE project_equipment_assets ADD COLUMN IF NOT EXISTS driver_phone VARCHAR(50)");
  await pool.query("ALTER TABLE project_equipment_assets ADD COLUMN IF NOT EXISTS rental_vendor VARCHAR(160)");
  await pool.query("ALTER TABLE project_equipment_assets ADD COLUMN IF NOT EXISTS status VARCHAR(30) NOT NULL DEFAULT 'ACTIVE'");
  await pool.query("ALTER TABLE project_equipment_assets ADD COLUMN IF NOT EXISTS note TEXT");
  await pool.query("ALTER TABLE project_construction_diaries ADD COLUMN IF NOT EXISTS diary_code VARCHAR(80)");
  await pool.query("ALTER TABLE project_construction_diaries ADD COLUMN IF NOT EXISTS site_photo_data TEXT");
  await pool.query("ALTER TABLE project_construction_diaries ADD COLUMN IF NOT EXISTS weather_morning VARCHAR(80)");
  await pool.query("ALTER TABLE project_construction_diaries ADD COLUMN IF NOT EXISTS weather_afternoon VARCHAR(80)");
  await pool.query("ALTER TABLE project_construction_diaries ADD COLUMN IF NOT EXISTS weather_evening VARCHAR(80)");
  await pool.query("ALTER TABLE project_construction_diaries ADD COLUMN IF NOT EXISTS weather_night VARCHAR(80)");
  await pool.query("ALTER TABLE project_construction_diaries ADD COLUMN IF NOT EXISTS site_condition TEXT");
  await pool.query("ALTER TABLE project_construction_diaries ADD COLUMN IF NOT EXISTS temperature VARCHAR(40)");
  await pool.query("ALTER TABLE project_construction_diaries ADD COLUMN IF NOT EXISTS incident_report TEXT");
  await pool.query("ALTER TABLE project_construction_diaries ADD COLUMN IF NOT EXISTS safety_rating VARCHAR(20)");
  await pool.query("ALTER TABLE project_construction_diaries ADD COLUMN IF NOT EXISTS quality_rating VARCHAR(20)");
  await pool.query("ALTER TABLE project_construction_diaries ADD COLUMN IF NOT EXISTS progress_rating VARCHAR(20)");
  await pool.query("ALTER TABLE project_construction_diaries ADD COLUMN IF NOT EXISTS hygiene_rating VARCHAR(20)");
  await pool.query("ALTER TABLE project_construction_diaries ADD COLUMN IF NOT EXISTS proposal TEXT");
  await pool.query("ALTER TABLE project_construction_diaries ADD COLUMN IF NOT EXISTS report_watchers TEXT");
  await pool.query("ALTER TABLE project_construction_diaries ADD COLUMN IF NOT EXISTS note TEXT");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_project_equipment_assets_project ON project_equipment_assets(project_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_project_equipment_logs_project_equipment ON project_equipment_logs(project_id, equipment_id)");

  await pool.query(
    `UPDATE project_stages
     SET status = CASE
       WHEN COALESCE(progress_percent, 0) >= 100 THEN 'COMPLETED'
       WHEN COALESCE(progress_percent, 0) > 0 THEN 'IN_PROGRESS'
       ELSE 'NOT_STARTED'
     END
     WHERE status NOT IN ('NOT_STARTED', 'IN_PROGRESS', 'COMPLETED') OR status IS NULL`
  );

  await pool.query(
    `UPDATE project_stages ps
     SET is_locked = CASE
       WHEN ps.stage_order = (
         SELECT MIN(s2.stage_order)
         FROM project_stages s2
         WHERE s2.project_id = ps.project_id
       ) THEN FALSE
       ELSE COALESCE(ps.is_locked, TRUE)
     END`
  );

  await pool.query("CREATE INDEX IF NOT EXISTS idx_project_stages_project_order ON project_stages(project_id, stage_order)");

  await seedDefaultStageTemplates(pool);
}

async function writeDataLog({ action, collection, recordId, username, metadata }) {
  try {
    await pool.query(
      `INSERT INTO data_logs (service_name, action, collection, record_id, username, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ["project-service", action, collection, recordId || null, username || null, metadata || null]
    );
  } catch (error) {
    console.error("writeDataLog failed:", error.message);
  }
}

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  try {
    const token = authHeader.split(" ")[1];
    req.user = jwt.verify(token, ACCESS_SECRET, { issuer: TOKEN_ISSUER });
    return next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid token" });
  }
}

function authorize(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    return next();
  };
}

app.get("/health", (req, res) => {
  res.json({ service: "project-service", status: "ok" });
});

app.get("/projects", authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query("SELECT * FROM projects ORDER BY id DESC");

    await writeDataLog({
      action: "read",
      collection: "project",
      recordId: "list",
      username: req.user.email,
      metadata: { count: rows.length }
    });

    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch projects", error: error.message });
  }
});

app.get("/projects/my", authenticate, authorize("EMPLOYEE"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.*, psa.assignment_role, psa.work_start, psa.work_end,
              psa.stage_id,
              ps.stage_name,
              ps.stage_order,
              ps.status AS stage_status,
              ps.progress_percent AS stage_progress_percent
      FROM project_stage_assignments psa
      JOIN projects p ON psa.project_id = p.id
       JOIN project_stages ps ON psa.stage_id = ps.id
       WHERE psa.user_id = $1
       ORDER BY p.created_at DESC, ps.stage_order ASC`,
      [req.user.sub]
    );

    await writeDataLog({
      action: "read",
      collection: "employee-project",
      recordId: String(req.user.sub),
      username: req.user.email,
      metadata: { count: result.rows.length }
    });

    return res.json(result.rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch employee projects", error: error.message });
  }
});

app.get("/schedule", authenticate, authorize("EMPLOYEE"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT psa.*, p.name AS project_name, p.address, p.status AS project_status,
              ps.stage_name, ps.stage_order, ps.status AS stage_status, ps.progress_percent AS stage_progress_percent
       FROM project_stage_assignments psa
       JOIN projects p ON psa.project_id = p.id
       JOIN project_stages ps ON psa.stage_id = ps.id
       WHERE psa.user_id = $1
       ORDER BY psa.work_start DESC NULLS LAST, ps.stage_order ASC`,
      [req.user.sub]
    );

    await writeDataLog({
      action: "read",
      collection: "schedule",
      recordId: String(req.user.sub),
      username: req.user.email,
      metadata: { count: result.rows.length }
    });

    return res.json(result.rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch schedule", error: error.message });
  }
});

app.post("/projects", authenticate, authorize("PROJECT_MANAGER"), async (req, res) => {
  try {
    const {
      projectCode,
      name,
      address,
      latitude,
      longitude,
      startDate,
      endDate,
      status
    } = req.body;

    if (!projectCode || !name || latitude == null || longitude == null) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    await client.query("BEGIN");
    inTransaction = true;

    const result = await client.query(
      `INSERT INTO projects (project_code, name, address, latitude, longitude, start_date, end_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [projectCode, name, address || null, latitude, longitude, startDate || null, endDate || null, status || "PLANNING"]
    );

    await initializeProjectStages(result.rows[0].id, client);

    await client.query("COMMIT");
    inTransaction = false;

    await writeDataLog({
      action: "create",
      collection: "project",
      recordId: String(result.rows[0].id),
      username: req.user.email,
      metadata: { projectCode: result.rows[0].project_code, status: result.rows[0].status }
    });

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (inTransaction) {
      await client.query("ROLLBACK");
    }
    return res.status(500).json({ message: "Failed to create project", error: error.message });
  } finally {
    client.release();
  }
});

app.get("/projects/stage-templates", authenticate, authorize("ADMIN", "MANAGER"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, stage_name, default_order, created_at, updated_at
       FROM project_stage_templates
       ORDER BY default_order, id`
    );
    return res.json(result.rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch stage templates", error: error.message });
  }
});

app.get("/projects/:id(\\d+)/stages", authenticate, authorize("ADMIN", "MANAGER"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const project = await pool.query("SELECT id FROM projects WHERE id = $1", [projectId]);
    if (project.rowCount === 0) {
      return res.status(404).json({ message: "Project not found" });
    }

    await enforceSequentialStageLocks(projectId);

    const result = await pool.query(
      `SELECT id, project_id, stage_name, stage_order, created_from_template_id,
              progress_percent, status, is_locked, weight, started_at, completed_at,
              created_at, updated_at
       FROM project_stages
       WHERE project_id = $1
       ORDER BY stage_order, id`,
      [projectId]
    );
    return res.json(result.rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch project stages", error: error.message });
  }
});

app.post("/projects/:id(\\d+)/stages", authenticate, authorize("ADMIN", "MANAGER"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const { stageName, stageOrder, weight } = req.body;

    if (!stageName || !String(stageName).trim()) {
      return res.status(400).json({ message: "stageName is required" });
    }

    const project = await pool.query("SELECT id FROM projects WHERE id = $1", [projectId]);
    if (project.rowCount === 0) {
      return res.status(404).json({ message: "Project not found" });
    }

    const maxOrderResult = await pool.query("SELECT COALESCE(MAX(stage_order), 0) AS max_order FROM project_stages WHERE project_id = $1", [projectId]);
    const nextOrder = stageOrder == null ? Number(maxOrderResult.rows[0].max_order) + 1 : Number(stageOrder);

    const result = await pool.query(
      `INSERT INTO project_stages (project_id, stage_name, stage_order, weight, progress_percent, status, is_locked)
       VALUES ($1, $2, $3, $4, 0, 'NOT_STARTED', TRUE)
       RETURNING *`,
      [
        projectId,
        String(stageName).trim(),
        Number.isFinite(nextOrder) && nextOrder > 0 ? nextOrder : 1,
        weight == null ? 1 : Math.max(0.01, Number(weight))
      ]
    );

    await enforceSequentialStageLocks(projectId);
    await recalculateProjectProgress(projectId);

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to create project stage", error: error.message });
  }
});

app.put("/projects/:id(\\d+)/stages/:stageId(\\d+)", authenticate, authorize("ADMIN", "MANAGER"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const stageId = Number(req.params.stageId);
    const { stageName, weight, status } = req.body;

    if (stageName !== undefined && !String(stageName).trim()) {
      return res.status(400).json({ message: "stageName cannot be empty" });
    }

    if (status !== undefined && !STAGE_STATUSES.includes(String(status).toUpperCase())) {
      return res.status(400).json({ message: `status must be one of: ${STAGE_STATUSES.join(", ")}` });
    }

    if (stageName === undefined && weight === undefined && status === undefined) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    const normalizedStatus = status == null ? null : String(status).toUpperCase();

    const result = await pool.query(
      `UPDATE project_stages
       SET stage_name = COALESCE($1, stage_name),
           weight = COALESCE($2, weight),
           status = COALESCE($3::varchar, status),
           progress_percent = CASE
             WHEN $3::varchar = 'COMPLETED' THEN 100
             WHEN $3::varchar = 'NOT_STARTED' THEN 0
             WHEN $3::varchar = 'IN_PROGRESS' THEN GREATEST(COALESCE(progress_percent, 0), 1)
             ELSE progress_percent
           END,
           started_at = CASE
             WHEN $3::varchar = 'IN_PROGRESS' AND started_at IS NULL THEN NOW()
             WHEN $3::varchar = 'NOT_STARTED' THEN NULL
             ELSE started_at
           END,
           completed_at = CASE
             WHEN $3::varchar = 'COMPLETED' THEN NOW()
             WHEN $3::varchar IN ('NOT_STARTED', 'IN_PROGRESS') THEN NULL
             ELSE completed_at
           END,
           updated_at = NOW()
      WHERE id = $4 AND project_id = $5
       RETURNING *`,
      [
        stageName == null ? null : String(stageName).trim(),
        weight == null ? null : Math.max(0.01, Number(weight)),
        normalizedStatus,
        stageId,
        projectId
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Project stage not found" });
    }

    await enforceSequentialStageLocks(projectId);
    await recalculateProjectProgress(projectId);
    return res.json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to update project stage", error: error.message });
  }
});

app.delete("/projects/:id(\\d+)/stages/:stageId(\\d+)", authenticate, authorize("ADMIN", "MANAGER"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const stageId = Number(req.params.stageId);

    const result = await pool.query("DELETE FROM project_stages WHERE id = $1 AND project_id = $2", [stageId, projectId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Project stage not found" });
    }

    await enforceSequentialStageLocks(projectId);
    await recalculateProjectProgress(projectId);

    return res.json({ message: "Project stage deleted" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete project stage", error: error.message });
  }
});

app.post("/projects/:id(\\d+)/stages/reorder", authenticate, authorize("ADMIN", "MANAGER"), async (req, res) => {
  const client = await pool.connect();
  let inTransaction = false;
  try {
    const projectId = Number(req.params.id);
    const { stageIds } = req.body;

    if (!Array.isArray(stageIds) || stageIds.length === 0) {
      return res.status(400).json({ message: "stageIds must be a non-empty array" });
    }

    const numericStageIds = stageIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
    if (numericStageIds.length !== stageIds.length) {
      return res.status(400).json({ message: "stageIds contains invalid value" });
    }

    const existing = await client.query("SELECT id FROM project_stages WHERE project_id = $1 ORDER BY stage_order, id", [projectId]);
    const existingIds = existing.rows.map((row) => row.id);

    if (existingIds.length !== numericStageIds.length) {
      return res.status(400).json({ message: "stageIds must include all stages of the project" });
    }

    const existingIdSet = new Set(existingIds);
    const validSet = numericStageIds.every((id) => existingIdSet.has(id));
    if (!validSet) {
      return res.status(400).json({ message: "stageIds does not match project stage list" });
    }

    await client.query("BEGIN");
    inTransaction = true;

    for (let i = 0; i < numericStageIds.length; i += 1) {
      await client.query(
        `UPDATE project_stages
         SET stage_order = $1,
             updated_at = NOW()
         WHERE id = $2 AND project_id = $3`,
        [i + 1, numericStageIds[i], projectId]
      );
    }

    await enforceSequentialStageLocks(projectId, client);

    await client.query("COMMIT");
    inTransaction = false;

    await recalculateProjectProgress(projectId, client);

    const updated = await pool.query(
      `SELECT id, project_id, stage_name, stage_order, created_from_template_id,
              progress_percent, status, is_locked, weight, started_at, completed_at,
              created_at, updated_at
       FROM project_stages
       WHERE project_id = $1
       ORDER BY stage_order, id`,
      [projectId]
    );

    return res.json(updated.rows);
  } catch (error) {
    if (inTransaction) {
      await client.query("ROLLBACK");
    }
    return res.status(500).json({ message: "Failed to reorder project stages", error: error.message });
  } finally {
    client.release();
  }
});

app.post("/projects/:id(\\d+)/stages/:stageId(\\d+)/progress", authenticate, authorize("ADMIN", "MANAGER"), async (req, res) => {
  const client = await pool.connect();
  let inTransaction = false;
  try {
    const projectId = Number(req.params.id);
    const stageId = Number(req.params.stageId);
    const { progressPercent, note } = req.body;

    if (progressPercent == null || Number.isNaN(Number(progressPercent))) {
      return res.status(400).json({ message: "progressPercent is required" });
    }

    const normalized = Number(progressPercent);
    if (normalized < 0 || normalized > 100) {
      return res.status(400).json({ message: "progressPercent must be between 0 and 100" });
    }

    const stageResult = await client.query(
      `SELECT id, stage_name, stage_order, status, is_locked
       FROM project_stages
       WHERE id = $1 AND project_id = $2`,
      [stageId, projectId]
    );

    if (stageResult.rowCount === 0) {
      return res.status(404).json({ message: "Project stage not found" });
    }

    const stage = stageResult.rows[0];
    if (stage.is_locked) {
      return res.status(400).json({ message: "Stage is locked. Complete previous stage first." });
    }

    const prevResult = await client.query(
      `SELECT id, status
       FROM project_stages
       WHERE project_id = $1 AND stage_order < $2
       ORDER BY stage_order DESC, id DESC
       LIMIT 1`,
      [projectId, stage.stage_order]
    );

    if (prevResult.rowCount > 0 && prevResult.rows[0].status !== "COMPLETED") {
      return res.status(400).json({ message: "Cannot update this stage before previous stage is completed." });
    }

    await client.query("BEGIN");
    inTransaction = true;

    const nextStatus = normalized >= 100 ? "COMPLETED" : normalized > 0 ? "IN_PROGRESS" : "NOT_STARTED";
    const updateStage = await client.query(
      `UPDATE project_stages
       SET progress_percent = $1,
           status = $2::varchar,
           started_at = CASE
             WHEN $2::varchar = 'IN_PROGRESS' AND started_at IS NULL THEN NOW()
             ELSE started_at
           END,
           completed_at = CASE
             WHEN $2::varchar = 'COMPLETED' THEN NOW()
             WHEN $2::varchar <> 'COMPLETED' THEN NULL
             ELSE completed_at
           END,
           updated_by = $3,
           updated_at = NOW()
       WHERE id = $4 AND project_id = $5
       RETURNING *`,
      [normalized, nextStatus, req.user.sub, stageId, projectId]
    );

    await enforceSequentialStageLocks(projectId, client);
    const projectProgress = await recalculateProjectProgress(projectId, client);

    await client.query(
      `INSERT INTO project_progress_updates (project_id, progress_percent, note, updated_by)
       VALUES ($1, $2, $3, $4)`,
      [
        projectId,
        projectProgress.progressPercent,
        note || `Stage ${stage.stage_name}: ${normalized}%`,
        req.user.sub
      ]
    );

    await client.query("COMMIT");
    inTransaction = false;

    return res.json(updateStage.rows[0]);
  } catch (error) {
    if (inTransaction) {
      await client.query("ROLLBACK");
    }
    return res.status(500).json({ message: "Failed to update stage progress", error: error.message });
  } finally {
    client.release();
  }
});

app.put("/projects/:id", authenticate, authorize("PROJECT_MANAGER"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const { name, address, latitude, longitude, startDate, endDate, status } = req.body;

    const result = await pool.query(
      `UPDATE projects
       SET name = COALESCE($1, name),
           address = COALESCE($2, address),
           latitude = COALESCE($3, latitude),
           longitude = COALESCE($4, longitude),
           start_date = COALESCE($5, start_date),
           end_date = COALESCE($6, end_date),
           status = COALESCE($7, status),
           updated_at = NOW()
       WHERE id = $8
       RETURNING *`,
      [name, address, latitude, longitude, startDate, endDate, status, projectId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Project not found" });
    }

    await writeDataLog({
      action: "update",
      collection: "project",
      recordId: String(projectId),
      username: req.user.email,
      metadata: {
        changedFields: ["name", "address", "latitude", "longitude", "startDate", "endDate", "status"].filter(
          (field) => req.body[field] !== undefined
        )
      }
    });

    return res.json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to update project", error: error.message });
  }
});

app.delete("/projects/:id", authenticate, authorize("PROJECT_MANAGER"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const target = await pool.query("SELECT project_code FROM projects WHERE id = $1", [projectId]);
    const result = await pool.query("DELETE FROM projects WHERE id = $1", [projectId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Project not found" });
    }

    await writeDataLog({
      action: "delete",
      collection: "project",
      recordId: String(projectId),
      username: req.user.email,
      metadata: { projectCode: target.rows[0]?.project_code || null }
    });

    return res.json({ message: "Project deleted" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete project", error: error.message });
  }
});

app.get("/projects/:id/assignments", authenticate, async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const result = await pool.query(
      `SELECT psa.id, psa.user_id, psa.project_id, psa.stage_id, psa.assignment_role, psa.work_start, psa.work_end,
              ps.stage_name, ps.stage_order, ps.status AS stage_status, ps.progress_percent AS stage_progress_percent,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.last_name, u.first_name)), ''), u.full_name) AS full_name,
              u.employee_code, p.name AS project_name
       FROM project_stage_assignments psa
       JOIN users u ON psa.user_id = u.id
       JOIN projects p ON psa.project_id = p.id
       JOIN project_stages ps ON psa.stage_id = ps.id
       WHERE psa.project_id = $1
       ORDER BY ps.stage_order, psa.created_at DESC`,
      [projectId]
    );

    await writeDataLog({
      action: "read",
      collection: "project-assignment",
      recordId: String(projectId),
      username: req.user.email,
      metadata: { count: result.rows.length }
    });

    return res.json(result.rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch assignments", error: error.message });
  }
});

app.post("/projects/assignments", authenticate, authorize("PROJECT_MANAGER"), async (req, res) => {
  try {
    const { userId, projectId, stageId, assignmentRole, workStart, workEnd } = req.body;
    if (!userId || !projectId || !stageId) {
      return res.status(400).json({ message: "userId, projectId and stageId are required" });
    }

    const stageResult = await client.query(
      `SELECT id, status, is_locked
       FROM project_stages
       WHERE id = $1 AND project_id = $2`,
      [Number(stageId), Number(projectId)]
    );

    if (stageResult.rowCount === 0) {
      return res.status(404).json({ message: "Project stage not found" });
    }

    await client.query("BEGIN");
    inTransaction = true;

    const result = await client.query(
      `INSERT INTO project_stage_assignments (user_id, project_id, stage_id, assignment_role, work_start, work_end)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (user_id, stage_id)
       DO UPDATE SET
         assignment_role = EXCLUDED.assignment_role,
         work_start = EXCLUDED.work_start,
         work_end = EXCLUDED.work_end,
         updated_at = NOW()
       RETURNING *`,
      [Number(userId), Number(projectId), Number(stageId), assignmentRole || null, workStart || null, workEnd || null]
    );

    await client.query(
      `INSERT INTO project_assignments (user_id, project_id, assignment_role, work_start, work_end)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, project_id)
       DO UPDATE SET
         assignment_role = EXCLUDED.assignment_role,
         work_start = EXCLUDED.work_start,
         work_end = EXCLUDED.work_end`,
      [Number(userId), Number(projectId), assignmentRole || null, workStart || null, workEnd || null]
    );

    await client.query("COMMIT");
    inTransaction = false;

    await writeDataLog({
      action: "create",
      collection: "project-assignment",
      recordId: String(result.rows[0].id),
      username: req.user.email,
      metadata: { userId: Number(userId), projectId: Number(projectId), stageId: Number(stageId) }
    });

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (inTransaction) {
      await client.query("ROLLBACK");
    }
    return res.status(500).json({ message: "Failed to assign employee", error: error.message });
  } finally {
    client.release();
  }
});

app.delete("/projects/assignments/:id", authenticate, authorize("PROJECT_MANAGER"), async (req, res) => {
  try {
    const assignmentId = Number(req.params.id);
    const target = await client.query("SELECT user_id, project_id, stage_id FROM project_stage_assignments WHERE id = $1", [assignmentId]);
    if (target.rowCount === 0) {
      return res.status(404).json({ message: "Assignment not found" });
    }

    await client.query("BEGIN");
    inTransaction = true;

    await client.query("DELETE FROM project_stage_assignments WHERE id = $1", [assignmentId]);

    const remain = await client.query(
      `SELECT id
       FROM project_stage_assignments
       WHERE user_id = $1 AND project_id = $2
       LIMIT 1`,
      [target.rows[0].user_id, target.rows[0].project_id]
    );

    if (remain.rowCount === 0) {
      await client.query(
        `DELETE FROM project_assignments
         WHERE user_id = $1 AND project_id = $2`,
        [target.rows[0].user_id, target.rows[0].project_id]
      );
    }

    await client.query("COMMIT");
    inTransaction = false;

    await writeDataLog({
      action: "delete",
      collection: "project-assignment",
      recordId: String(assignmentId),
      username: req.user.email,
      metadata: {
        userId: target.rows[0]?.user_id || null,
        projectId: target.rows[0]?.project_id || null,
        stageId: target.rows[0]?.stage_id || null
      }
    });

    return res.json({ message: "Assignment removed" });
  } catch (error) {
    if (inTransaction) {
      await client.query("ROLLBACK");
    }
    return res.status(500).json({ message: "Failed to remove assignment", error: error.message });
  } finally {
    client.release();
  }
});

app.post("/projects/:id(\\d+)/progress", authenticate, authorize("PROJECT_MANAGER"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const { progressPercent, note } = req.body;

    if (progressPercent == null || Number.isNaN(Number(progressPercent))) {
      return res.status(400).json({ message: "progressPercent is required" });
    }

    const normalized = Number(progressPercent);
    if (normalized < 0 || normalized > 100) {
      return res.status(400).json({ message: "progressPercent must be between 0 and 100" });
    }

    const projectExists = await pool.query("SELECT id FROM projects WHERE id = $1", [projectId]);
    if (projectExists.rowCount === 0) {
      return res.status(404).json({ message: "Project not found" });
    }

    const result = await pool.query(
      `INSERT INTO project_progress_updates (project_id, progress_percent, note, updated_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [projectId, normalized, note || null, req.user.sub]
    );

    await pool.query(
      `UPDATE projects
       SET progress_percent = $1,
           status = CASE
             WHEN $1 >= 100 THEN 'COMPLETED'
             WHEN $1 > 0 THEN 'IN_PROGRESS'
             ELSE status
           END,
           updated_at = NOW()
       WHERE id = $2`,
      [normalized, projectId]
    );

    await writeDataLog({
      action: "create",
      collection: "project-progress",
      recordId: String(result.rows[0].id),
      username: req.user.email,
      metadata: { projectId, progressPercent: normalized }
    });

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({
      message: error?.message || "Failed to update project progress",
      error: error.message
    });
  }
});

app.get("/projects/:id(\\d+)/progress", authenticate, authorize("PROJECT_MANAGER"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const result = await pool.query(
      `SELECT ppu.*, COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.last_name, u.first_name)), ''), u.full_name) AS updated_by_name
       FROM project_progress_updates ppu
       LEFT JOIN users u ON ppu.updated_by = u.id
       WHERE ppu.project_id = $1
       ORDER BY ppu.created_at DESC`,
      [projectId]
    );

    await writeDataLog({
      action: "read",
      collection: "project-progress",
      recordId: String(projectId),
      username: req.user.email,
      metadata: { count: result.rows.length }
    });

    return res.json(result.rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch project progress", error: error.message });
  }
});

app.get("/projects/reports/progress", authenticate, authorize("PROJECT_MANAGER"), async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT p.id, p.project_code, p.name, p.status,
              COALESCE(last_progress.progress_percent, 0) AS latest_progress_percent,
              last_progress.created_at AS latest_progress_time
       FROM projects p
       LEFT JOIN LATERAL (
         SELECT progress_percent, created_at
         FROM project_progress_updates
         WHERE project_id = p.id
         ORDER BY created_at DESC
         LIMIT 1
       ) last_progress ON TRUE
       ORDER BY p.updated_at DESC`
    );

    await writeDataLog({
      action: "read",
      collection: "project-report",
      recordId: "progress-summary",
      username: req.user.email,
      metadata: { count: result.rows.length }
    });

    return res.json(result.rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to build progress report", error: error.message });
  }
});

app.post("/projects/:id(\\d+)/progress/auto-sync", authenticate, authorize("ADMIN", "MANAGER"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const { mode, note } = req.body || {};

    const projectExists = await pool.query("SELECT id FROM projects WHERE id = $1", [projectId]);
    if (projectExists.rowCount === 0) {
      return res.status(404).json({ message: "Project not found" });
    }

    const syncResult = await syncProjectProgressFromTasks(projectId, mode, pool);
    const autoNote =
      note ||
      `Auto-sync by ${syncResult.mode}: ${syncResult.progressPercent}% (${syncResult.completedTasks}/${syncResult.totalTasks} tasks completed)`;

    const progressRecord = await pool.query(
      `INSERT INTO project_progress_updates (project_id, progress_percent, note, updated_by)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [projectId, syncResult.progressPercent, autoNote, req.user.sub]
    );

    return res.status(201).json({
      ...syncResult,
      record: progressRecord.rows[0]
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to auto-sync project progress", error: error.message });
  }
});

