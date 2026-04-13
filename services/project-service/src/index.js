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
    if (!req.user) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const userRole = String(req.user.role || "").toUpperCase();
    const allowed = new Set(roles.map((role) => String(role || "").toUpperCase()));

    // Backward/forward compatibility for legacy role names.
    if (userRole === "PROJECT_MANAGER" && allowed.has("MANAGER")) {
      return next();
    }
    if (userRole === "MANAGER" && allowed.has("PROJECT_MANAGER")) {
      return next();
    }
    if (userRole === "SUPER_ADMIN" && allowed.has("ADMIN")) {
      return next();
    }

    if (!allowed.has(userRole)) {
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

app.post("/projects", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
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

app.put("/projects/:id", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
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

app.delete("/projects/:id", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
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

app.post("/projects/assignments", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
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

app.delete("/projects/assignments/:id", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
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

app.post("/projects/:id(\\d+)/progress", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
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

app.get("/projects/:id(\\d+)/progress", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
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

app.get("/projects/reports/progress", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
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

app.get("/projects/progress-dashboard", authenticate, authorize("ADMIN", "MANAGER"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
          p.id,
          p.project_code,
          p.name,
          p.status,
          COALESCE(p.progress_percent, 0) AS project_progress_percent,
          p.start_date,
          p.end_date,
          COALESCE(t.total_tasks, 0) AS total_tasks,
          COALESCE(t.completed_tasks, 0) AS completed_tasks,
          COALESCE(t.total_quantity, 0) AS total_quantity,
          COALESCE(t.completed_quantity, 0) AS completed_quantity,
          latest_progress.progress_percent AS latest_progress_percent,
          latest_progress.created_at AS latest_progress_time,
          d.latest_diary_date,
          COALESCE(d.today_diary_count, 0) AS today_diary_count
       FROM projects p
       LEFT JOIN LATERAL (
         SELECT
           COUNT(*)::int AS total_tasks,
           COUNT(*) FILTER (WHERE UPPER(COALESCE(status, '')) IN ('DONE', 'COMPLETED') OR actual_end_date IS NOT NULL)::int AS completed_tasks,
           COALESCE(SUM(COALESCE(quantity, 0)), 0) AS total_quantity,
           COALESCE(SUM(CASE WHEN UPPER(COALESCE(status, '')) IN ('DONE', 'COMPLETED') OR actual_end_date IS NOT NULL THEN COALESCE(quantity, 0) ELSE 0 END), 0) AS completed_quantity
         FROM project_plan_boq_items
         WHERE project_id = p.id
       ) t ON TRUE
       LEFT JOIN LATERAL (
         SELECT progress_percent, created_at
         FROM project_progress_updates
         WHERE project_id = p.id
         ORDER BY created_at DESC
         LIMIT 1
       ) latest_progress ON TRUE
       LEFT JOIN LATERAL (
         SELECT
           MAX(diary_date) AS latest_diary_date,
           COUNT(*) FILTER (WHERE diary_date = CURRENT_DATE)::int AS today_diary_count
         FROM project_construction_diaries
         WHERE project_id = p.id
       ) d ON TRUE
       ORDER BY p.updated_at DESC`
    );

    const normalized = rows.map((row) => {
      const progress = Number(row.project_progress_percent || 0);
      const overdue = row.end_date && new Date(row.end_date).getTime() < Date.now() && progress < 100;
      const health = overdue ? "DELAYED" : progress < 40 ? "AT_RISK" : "NORMAL";
      return {
        ...row,
        health_status: health,
        quantity_completion_percent:
          Number(row.total_quantity || 0) > 0
            ? Math.round((Number(row.completed_quantity || 0) / Number(row.total_quantity || 1)) * 10000) / 100
            : 0
      };
    });

    return res.json(normalized);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch progress dashboard", error: error.message });
  }
});

app.get("/projects/:id(\\d+)/plan-boq", authenticate, authorize("ADMIN", "MANAGER"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const { rows } = await pool.query(
      `SELECT pbi.*, ps.stage_name, ps.stage_order
       FROM project_plan_boq_items pbi
       LEFT JOIN project_stages ps ON ps.id = pbi.stage_id
       WHERE pbi.project_id = $1
       ORDER BY COALESCE(ps.stage_order, 999999), pbi.created_at DESC`,
      [projectId]
    );
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch plan & boq items", error: error.message });
  }
});

app.post("/projects/:id(\\d+)/plan-boq", authenticate, authorize("ADMIN", "MANAGER"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const {
      stageId,
      itemType,
      wbsCode,
      parentWbsCode,
      dependencyWbsCode,
      dependencyType,
      itemName,
      description,
      unit,
      quantity,
      unitCost,
      status,
      plannedDate,
      plannedEndDate,
      actualDate,
      actualEndDate
    } = req.body;

    if (!itemName) {
      return res.status(400).json({ message: "itemName is required" });
    }

    const stageResult = await pool.query(
      `SELECT id
       FROM project_stages
       WHERE id = $1 AND project_id = $2`,
      [Number(stageId || 0), projectId]
    );
    if (stageResult.rowCount === 0) {
      return res.status(400).json({ message: "stageId is required and must belong to project" });
    }

    const result = await pool.query(
      `INSERT INTO project_plan_boq_items
       (project_id, stage_id, item_type, wbs_code, parent_wbs_code, dependency_wbs_code, dependency_type, item_name, description, unit, quantity, unit_cost, status, planned_date, planned_end_date, actual_date, actual_end_date, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18)
       RETURNING *`,
      [
        projectId,
        Number(stageId),
        itemType || "PLAN",
        wbsCode || null,
        parentWbsCode || null,
        dependencyWbsCode || null,
        dependencyType ? String(dependencyType).toUpperCase() : null,
        itemName,
        description || null,
        unit || null,
        Number(quantity || 0),
        Number(unitCost || 0),
        status || "PLANNED",
        plannedDate || null,
        plannedEndDate || null,
        actualDate || null,
        actualEndDate || null,
        req.user.sub
      ]
    );

    await syncProjectProgressFromStageTasks(projectId, pool);
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to create plan & boq item", error: error.message });
  }
});

app.put("/projects/:id(\\d+)/plan-boq/:itemId(\\d+)", authenticate, authorize("ADMIN", "MANAGER"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    const {
      stageId,
      itemType,
      wbsCode,
      parentWbsCode,
      dependencyWbsCode,
      dependencyType,
      itemName,
      description,
      unit,
      quantity,
      unitCost,
      status,
      plannedDate,
      plannedEndDate,
      actualDate,
      actualEndDate
    } = req.body;

    let normalizedStageId = null;
    if (stageId != null) {
      const stageResult = await pool.query(
        `SELECT id
         FROM project_stages
         WHERE id = $1 AND project_id = $2`,
        [Number(stageId || 0), projectId]
      );
      if (stageResult.rowCount === 0) {
        return res.status(400).json({ message: "stageId must belong to project" });
      }
      normalizedStageId = Number(stageId);
    }

    const result = await pool.query(
      `UPDATE project_plan_boq_items
       SET stage_id = COALESCE($1, stage_id),
           item_type = COALESCE($2, item_type),
           wbs_code = COALESCE($3, wbs_code),
           parent_wbs_code = COALESCE($4, parent_wbs_code),
           dependency_wbs_code = COALESCE($5, dependency_wbs_code),
           dependency_type = COALESCE($6, dependency_type),
           item_name = COALESCE($7, item_name),
           description = COALESCE($8, description),
           unit = COALESCE($9, unit),
           quantity = COALESCE($10, quantity),
           unit_cost = COALESCE($11, unit_cost),
           status = COALESCE($12, status),
           planned_date = COALESCE($13, planned_date),
           planned_end_date = COALESCE($14, planned_end_date),
           actual_date = COALESCE($15, actual_date),
           actual_end_date = COALESCE($16, actual_end_date),
           updated_by = $17,
           updated_at = NOW()
       WHERE id = $18 AND project_id = $19
       RETURNING *`,
      [
        normalizedStageId,
        itemType,
        wbsCode,
        parentWbsCode,
        dependencyWbsCode,
        dependencyType ? String(dependencyType).toUpperCase() : null,
        itemName,
        description,
        unit,
        quantity == null ? null : Number(quantity),
        unitCost == null ? null : Number(unitCost),
        status,
        plannedDate,
        plannedEndDate,
        actualDate,
        actualEndDate,
        req.user.sub,
        itemId,
        projectId
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Plan & boq item not found" });
    }

    await syncProjectProgressFromStageTasks(projectId, pool);
    return res.json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to update plan & boq item", error: error.message });
  }
});

app.delete("/projects/:id(\\d+)/plan-boq/:itemId(\\d+)", authenticate, authorize("ADMIN", "MANAGER"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    const result = await pool.query("DELETE FROM project_plan_boq_items WHERE id = $1 AND project_id = $2", [itemId, projectId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Plan & boq item not found" });
    }

    await syncProjectProgressFromStageTasks(projectId, pool);
    return res.json({ message: "Plan & boq item deleted" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete plan & boq item", error: error.message });
  }
});

app.get("/projects/schedule", authenticate, async (req, res) => {
  try {
    const userId = Number(req.user.sub);
    const { rows } = await pool.query(
      `SELECT
         pa.id,
         pa.assignment_role,
         pa.work_start,
         pa.work_end,
         p.id AS project_id,
         p.name AS project_name,
         p.project_code,
         p.status AS project_status,
         p.address
       FROM project_assignments pa
       JOIN projects p ON p.id = pa.project_id
       WHERE pa.user_id = $1
       ORDER BY COALESCE(pa.work_start, p.start_date) DESC, pa.id DESC`,
      [userId]
    );
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load project schedule", error: error.message });
  }
});

app.get("/projects/:id(\\d+)/materials", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const { rows } = await pool.query(
      `SELECT *
       FROM project_material_logs
       WHERE project_id = $1
       ORDER BY created_at DESC, id DESC`,
      [projectId]
    );
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch materials", error: error.message });
  }
});

app.post("/projects/:id(\\d+)/materials", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const { materialName, unit, plannedQty, receivedQty, usedQty, unitCost, supplier, status, note } = req.body;
    if (!materialName) {
      return res.status(400).json({ message: "materialName is required" });
    }

    const { rows } = await pool.query(
      `INSERT INTO project_material_logs
       (project_id, material_name, unit, planned_qty, received_qty, used_qty, unit_cost, supplier, status, note, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
       RETURNING *`,
      [
        projectId,
        materialName,
        unit || null,
        Number(plannedQty || 0),
        Number(receivedQty || 0),
        Number(usedQty || 0),
        Number(unitCost || 0),
        supplier || null,
        status || "IN_PROGRESS",
        note || null,
        req.user.sub
      ]
    );
    return res.status(201).json(rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to create material", error: error.message });
  }
});

app.put("/projects/:id(\\d+)/materials/:itemId(\\d+)", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    const { materialName, unit, plannedQty, receivedQty, usedQty, unitCost, supplier, status, note } = req.body;
    const { rows } = await pool.query(
      `UPDATE project_material_logs
       SET material_name = COALESCE($1, material_name),
           unit = COALESCE($2, unit),
           planned_qty = COALESCE($3, planned_qty),
           received_qty = COALESCE($4, received_qty),
           used_qty = COALESCE($5, used_qty),
           unit_cost = COALESCE($6, unit_cost),
           supplier = COALESCE($7, supplier),
           status = COALESCE($8, status),
           note = COALESCE($9, note),
           updated_by = $10,
           updated_at = NOW()
       WHERE id = $11 AND project_id = $12
       RETURNING *`,
      [
        materialName,
        unit,
        plannedQty == null ? null : Number(plannedQty),
        receivedQty == null ? null : Number(receivedQty),
        usedQty == null ? null : Number(usedQty),
        unitCost == null ? null : Number(unitCost),
        supplier,
        status,
        note,
        req.user.sub,
        itemId,
        projectId
      ]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: "Material not found" });
    }
    return res.json(rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to update material", error: error.message });
  }
});

app.delete("/projects/:id(\\d+)/materials/:itemId(\\d+)", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    const result = await pool.query("DELETE FROM project_material_logs WHERE id = $1 AND project_id = $2", [itemId, projectId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Material not found" });
    }
    return res.json({ message: "Material deleted" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete material", error: error.message });
  }
});

app.get("/projects/:id(\\d+)/costs", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const { rows } = await pool.query(
      `SELECT *
       FROM project_cost_entries
       WHERE project_id = $1
       ORDER BY COALESCE(incurred_on, created_at) DESC, id DESC`,
      [projectId]
    );
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch cost entries", error: error.message });
  }
});

app.post("/projects/:id(\\d+)/costs", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const { category, description, amount, incurredOn, status } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO project_cost_entries
       (project_id, category, description, amount, incurred_on, status, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$7)
       RETURNING *`,
      [projectId, category || "GENERAL", description || null, Number(amount || 0), incurredOn || null, status || "DRAFT", req.user.sub]
    );
    return res.status(201).json(rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to create cost entry", error: error.message });
  }
});

app.put("/projects/:id(\\d+)/costs/:costId(\\d+)", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const costId = Number(req.params.costId);
    const { category, description, amount, incurredOn, status } = req.body;
    const { rows } = await pool.query(
      `UPDATE project_cost_entries
       SET category = COALESCE($1, category),
           description = COALESCE($2, description),
           amount = COALESCE($3, amount),
           incurred_on = COALESCE($4, incurred_on),
           status = COALESCE($5, status),
           updated_by = $6,
           updated_at = NOW()
       WHERE id = $7 AND project_id = $8
       RETURNING *`,
      [category, description, amount == null ? null : Number(amount), incurredOn, status, req.user.sub, costId, projectId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: "Cost entry not found" });
    }
    return res.json(rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to update cost entry", error: error.message });
  }
});

app.delete("/projects/:id(\\d+)/costs/:costId(\\d+)", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const costId = Number(req.params.costId);
    const result = await pool.query("DELETE FROM project_cost_entries WHERE id = $1 AND project_id = $2", [costId, projectId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Cost entry not found" });
    }
    return res.json({ message: "Cost entry deleted" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete cost entry", error: error.message });
  }
});

app.get("/projects/:id(\\d+)/budget-plan", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const { rows } = await pool.query("SELECT * FROM project_budget_plans WHERE project_id = $1", [projectId]);
    if (rows.length === 0) {
      return res.json({
        project_id: projectId,
        planned_budget: 0,
        planned_disbursement: 0,
        planned_revenue: 0,
        note: null
      });
    }
    return res.json(rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load budget plan", error: error.message });
  }
});

app.put("/projects/:id(\\d+)/budget-plan", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const { plannedBudget, plannedDisbursement, plannedRevenue, note } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO project_budget_plans
       (project_id, planned_budget, planned_disbursement, planned_revenue, note, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (project_id)
       DO UPDATE SET
         planned_budget = EXCLUDED.planned_budget,
         planned_disbursement = EXCLUDED.planned_disbursement,
         planned_revenue = EXCLUDED.planned_revenue,
         note = EXCLUDED.note,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING *`,
      [projectId, Number(plannedBudget || 0), Number(plannedDisbursement || 0), Number(plannedRevenue || 0), note || null, req.user.sub]
    );
    return res.json(rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to save budget plan", error: error.message });
  }
});

app.get("/projects/:id(\\d+)/budget-vouchers", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const { rows } = await pool.query(
      `SELECT *
       FROM project_budget_vouchers
       WHERE project_id = $1
       ORDER BY COALESCE(voucher_date, created_at) DESC, id DESC`,
      [projectId]
    );
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load vouchers", error: error.message });
  }
});

app.post("/projects/:id(\\d+)/budget-vouchers", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const { voucherCode, voucherType, category, amount, voucherDate, status, description } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO project_budget_vouchers
       (project_id, voucher_code, voucher_type, category, amount, voucher_date, status, description, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9)
       RETURNING *`,
      [
        projectId,
        voucherCode || null,
        String(voucherType || "EXPENSE").toUpperCase(),
        category || null,
        Number(amount || 0),
        voucherDate || null,
        status || "DRAFT",
        description || null,
        req.user.sub
      ]
    );
    return res.status(201).json(rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to create voucher", error: error.message });
  }
});

app.put("/projects/:id(\\d+)/budget-vouchers/:voucherId(\\d+)", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const voucherId = Number(req.params.voucherId);
    const { voucherCode, voucherType, category, amount, voucherDate, status, description } = req.body;
    const { rows } = await pool.query(
      `UPDATE project_budget_vouchers
       SET voucher_code = COALESCE($1, voucher_code),
           voucher_type = COALESCE($2, voucher_type),
           category = COALESCE($3, category),
           amount = COALESCE($4, amount),
           voucher_date = COALESCE($5, voucher_date),
           status = COALESCE($6, status),
           description = COALESCE($7, description),
           updated_by = $8,
           updated_at = NOW()
       WHERE id = $9 AND project_id = $10
       RETURNING *`,
      [
        voucherCode,
        voucherType ? String(voucherType).toUpperCase() : null,
        category,
        amount == null ? null : Number(amount),
        voucherDate,
        status,
        description,
        req.user.sub,
        voucherId,
        projectId
      ]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: "Voucher not found" });
    }
    return res.json(rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to update voucher", error: error.message });
  }
});

app.delete("/projects/:id(\\d+)/budget-vouchers/:voucherId(\\d+)", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const voucherId = Number(req.params.voucherId);
    const result = await pool.query("DELETE FROM project_budget_vouchers WHERE id = $1 AND project_id = $2", [voucherId, projectId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Voucher not found" });
    }
    return res.json({ message: "Voucher deleted" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete voucher", error: error.message });
  }
});

app.get("/projects/:id(\\d+)/budget-summary", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const [planResult, voucherResult] = await Promise.all([
      pool.query("SELECT * FROM project_budget_plans WHERE project_id = $1", [projectId]),
      pool.query(
        `SELECT
           COALESCE(SUM(CASE WHEN voucher_type = 'EXPENSE' AND UPPER(COALESCE(status, '')) <> 'CANCELLED' THEN amount ELSE 0 END), 0) AS total_expense,
           COALESCE(SUM(CASE WHEN voucher_type = 'INCOME' AND UPPER(COALESCE(status, '')) <> 'CANCELLED' THEN amount ELSE 0 END), 0) AS total_income
         FROM project_budget_vouchers
         WHERE project_id = $1`,
        [projectId]
      )
    ]);

    const plan = planResult.rows[0] || {
      planned_budget: 0,
      planned_disbursement: 0,
      planned_revenue: 0
    };
    const totalExpense = Number(voucherResult.rows[0]?.total_expense || 0);
    const totalIncome = Number(voucherResult.rows[0]?.total_income || 0);
    const plannedDisbursement = Number(plan.planned_disbursement || 0);
    const plannedRevenue = Number(plan.planned_revenue || 0);

    return res.json({
      plannedBudget: Number(plan.planned_budget || 0),
      plannedDisbursement,
      plannedRevenue,
      actualDisbursement: totalExpense,
      actualRevenue: totalIncome,
      disbursementProgress: plannedDisbursement > 0 ? Math.round((totalExpense / plannedDisbursement) * 10000) / 100 : 0,
      plannedProfit: plannedRevenue - plannedDisbursement,
      actualProfit: totalIncome - totalExpense,
      forecastProfit: plannedRevenue - totalExpense
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load budget summary", error: error.message });
  }
});

app.get("/projects/:id(\\d+)/equipment-assets", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const { rows } = await pool.query(
      `SELECT *
       FROM project_equipment_assets
       WHERE project_id = $1
       ORDER BY created_at DESC, id DESC`,
      [projectId]
    );
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load equipment assets", error: error.message });
  }
});

app.post("/projects/:id(\\d+)/equipment-assets", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const {
      licensePlate,
      equipmentType,
      brand,
      model,
      vinNo,
      engineNo,
      fuelType,
      ownershipType,
      driverName,
      driverCode,
      driverPhone,
      rentalVendor,
      status,
      note
    } = req.body;
    if (!licensePlate) {
      return res.status(400).json({ message: "licensePlate is required" });
    }

    const { rows } = await pool.query(
      `INSERT INTO project_equipment_assets
       (project_id, license_plate, equipment_type, brand, model, vin_no, engine_no, fuel_type, ownership_type, driver_name, driver_code, driver_phone, rental_vendor, status, note, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$16)
       RETURNING *`,
      [
        projectId,
        String(licensePlate).trim(),
        equipmentType || null,
        brand || null,
        model || null,
        vinNo || null,
        engineNo || null,
        fuelType || "DIESEL",
        ownershipType || "OWNED",
        driverName || null,
        driverCode || null,
        driverPhone || null,
        rentalVendor || null,
        status || "ACTIVE",
        note || null,
        req.user.sub
      ]
    );
    return res.status(201).json(rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to create equipment asset", error: error.message });
  }
});

app.put("/projects/:id(\\d+)/equipment-assets/:assetId(\\d+)", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const assetId = Number(req.params.assetId);
    const {
      licensePlate,
      equipmentType,
      brand,
      model,
      vinNo,
      engineNo,
      fuelType,
      ownershipType,
      driverName,
      driverCode,
      driverPhone,
      rentalVendor,
      status,
      note
    } = req.body;

    const { rows } = await pool.query(
      `UPDATE project_equipment_assets
       SET license_plate = COALESCE($1, license_plate),
           equipment_type = COALESCE($2, equipment_type),
           brand = COALESCE($3, brand),
           model = COALESCE($4, model),
           vin_no = COALESCE($5, vin_no),
           engine_no = COALESCE($6, engine_no),
           fuel_type = COALESCE($7, fuel_type),
           ownership_type = COALESCE($8, ownership_type),
           driver_name = COALESCE($9, driver_name),
           driver_code = COALESCE($10, driver_code),
           driver_phone = COALESCE($11, driver_phone),
           rental_vendor = COALESCE($12, rental_vendor),
           status = COALESCE($13, status),
           note = COALESCE($14, note),
           updated_by = $15,
           updated_at = NOW()
       WHERE id = $16 AND project_id = $17
       RETURNING *`,
      [
        licensePlate,
        equipmentType,
        brand,
        model,
        vinNo,
        engineNo,
        fuelType,
        ownershipType,
        driverName,
        driverCode,
        driverPhone,
        rentalVendor,
        status,
        note,
        req.user.sub,
        assetId,
        projectId
      ]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Equipment asset not found" });
    }
    return res.json(rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to update equipment asset", error: error.message });
  }
});

app.delete("/projects/:id(\\d+)/equipment-assets/:assetId(\\d+)", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const assetId = Number(req.params.assetId);
    const result = await pool.query("DELETE FROM project_equipment_assets WHERE id = $1 AND project_id = $2", [assetId, projectId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Equipment asset not found" });
    }
    return res.json({ message: "Equipment asset deleted" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete equipment asset", error: error.message });
  }
});

app.get("/projects/:id(\\d+)/equipment-assets/:assetId(\\d+)/logs", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const assetId = Number(req.params.assetId);
    const logType = req.query.logType ? String(req.query.logType).toUpperCase() : null;

    const assetResult = await pool.query("SELECT id FROM project_equipment_assets WHERE id = $1 AND project_id = $2", [assetId, projectId]);
    if (assetResult.rowCount === 0) {
      return res.status(404).json({ message: "Equipment asset not found" });
    }

    const { rows } = await pool.query(
      `SELECT *
       FROM project_equipment_logs
       WHERE project_id = $1
         AND equipment_id = $2
         AND ($3::text IS NULL OR log_type = $3)
       ORDER BY COALESCE(log_date, created_at) DESC, id DESC`,
      [projectId, assetId, logType]
    );
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load equipment logs", error: error.message });
  }
});

app.post("/projects/:id(\\d+)/equipment-assets/:assetId(\\d+)/logs", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const assetId = Number(req.params.assetId);
    const { logType, logDate, title, description, tripCount, distanceKm, fuelLiters, odometerKm, costAmount, status } = req.body;

    const assetResult = await pool.query("SELECT id FROM project_equipment_assets WHERE id = $1 AND project_id = $2", [assetId, projectId]);
    if (assetResult.rowCount === 0) {
      return res.status(404).json({ message: "Equipment asset not found" });
    }

    const { rows } = await pool.query(
      `INSERT INTO project_equipment_logs
       (project_id, equipment_id, log_type, log_date, title, description, trip_count, distance_km, fuel_liters, odometer_km, cost_amount, status, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
       RETURNING *`,
      [
        projectId,
        assetId,
        String(logType || "TRIP_SHIFT").toUpperCase(),
        logDate || null,
        title || null,
        description || null,
        tripCount == null ? null : Number(tripCount),
        distanceKm == null ? null : Number(distanceKm),
        fuelLiters == null ? null : Number(fuelLiters),
        odometerKm == null ? null : Number(odometerKm),
        costAmount == null ? null : Number(costAmount),
        status || null,
        req.user.sub
      ]
    );

    return res.status(201).json(rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to create equipment log", error: error.message });
  }
});

app.delete("/projects/:id(\\d+)/equipment-assets/:assetId(\\d+)/logs/:logId(\\d+)", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const assetId = Number(req.params.assetId);
    const logId = Number(req.params.logId);
    const result = await pool.query(
      "DELETE FROM project_equipment_logs WHERE id = $1 AND project_id = $2 AND equipment_id = $3",
      [logId, projectId, assetId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Equipment log not found" });
    }
    return res.json({ message: "Equipment log deleted" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete equipment log", error: error.message });
  }
});

app.get("/projects/:id(\\d+)/construction-diary", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const { rows } = await pool.query(
      `SELECT *
       FROM project_construction_diaries
       WHERE project_id = $1
       ORDER BY COALESCE(diary_date, created_at) DESC, id DESC`,
      [projectId]
    );
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load construction diaries", error: error.message });
  }
});

app.post("/projects/:id(\\d+)/construction-diary", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const {
      diaryCode,
      diaryDate,
      title,
      sitePhotoData,
      workContent,
      issues,
      weather,
      weatherMorning,
      weatherAfternoon,
      weatherEvening,
      weatherNight,
      siteCondition,
      temperature,
      incidentReport,
      safetyRating,
      qualityRating,
      progressRating,
      hygieneRating,
      proposal,
      reportWatchers,
      note,
      status
    } = req.body;

    const resolvedTitle = title || diaryCode || "Construction diary";

    const { rows } = await pool.query(
      `INSERT INTO project_construction_diaries
       (project_id, diary_code, diary_date, title, site_photo_data, work_content, issues, weather, weather_morning, weather_afternoon, weather_evening, weather_night, site_condition, temperature, incident_report, safety_rating, quality_rating, progress_rating, hygiene_rating, proposal, report_watchers, note, status, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$24)
       RETURNING *`,
      [
        projectId,
        diaryCode || null,
        diaryDate || null,
        resolvedTitle,
        sitePhotoData || null,
        workContent || null,
        issues || null,
        weather || null,
        weatherMorning || null,
        weatherAfternoon || null,
        weatherEvening || null,
        weatherNight || null,
        siteCondition || null,
        temperature || null,
        incidentReport || null,
        safetyRating || null,
        qualityRating || null,
        progressRating || null,
        hygieneRating || null,
        proposal || null,
        reportWatchers || null,
        note || null,
        status || "OPEN",
        req.user.sub
      ]
    );
    return res.status(201).json(rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to create construction diary", error: error.message });
  }
});

app.put("/projects/:id(\\d+)/construction-diary/:diaryId(\\d+)", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const diaryId = Number(req.params.diaryId);
    const {
      diaryCode,
      diaryDate,
      title,
      sitePhotoData,
      workContent,
      issues,
      weather,
      weatherMorning,
      weatherAfternoon,
      weatherEvening,
      weatherNight,
      siteCondition,
      temperature,
      incidentReport,
      safetyRating,
      qualityRating,
      progressRating,
      hygieneRating,
      proposal,
      reportWatchers,
      note,
      status
    } = req.body;

    const { rows } = await pool.query(
      `UPDATE project_construction_diaries
       SET diary_code = COALESCE($1, diary_code),
           diary_date = COALESCE($2, diary_date),
           title = COALESCE($3, title),
           site_photo_data = COALESCE($4, site_photo_data),
           work_content = COALESCE($5, work_content),
           issues = COALESCE($6, issues),
           weather = COALESCE($7, weather),
           weather_morning = COALESCE($8, weather_morning),
           weather_afternoon = COALESCE($9, weather_afternoon),
           weather_evening = COALESCE($10, weather_evening),
           weather_night = COALESCE($11, weather_night),
           site_condition = COALESCE($12, site_condition),
           temperature = COALESCE($13, temperature),
           incident_report = COALESCE($14, incident_report),
           safety_rating = COALESCE($15, safety_rating),
           quality_rating = COALESCE($16, quality_rating),
           progress_rating = COALESCE($17, progress_rating),
           hygiene_rating = COALESCE($18, hygiene_rating),
           proposal = COALESCE($19, proposal),
           report_watchers = COALESCE($20, report_watchers),
           note = COALESCE($21, note),
           status = COALESCE($22, status),
           updated_by = $23,
           updated_at = NOW()
       WHERE id = $24 AND project_id = $25
       RETURNING *`,
      [
        diaryCode,
        diaryDate,
        title,
        sitePhotoData,
        workContent,
        issues,
        weather,
        weatherMorning,
        weatherAfternoon,
        weatherEvening,
        weatherNight,
        siteCondition,
        temperature,
        incidentReport,
        safetyRating,
        qualityRating,
        progressRating,
        hygieneRating,
        proposal,
        reportWatchers,
        note,
        status,
        req.user.sub,
        diaryId,
        projectId
      ]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Construction diary not found" });
    }
    return res.json(rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to update construction diary", error: error.message });
  }
});

app.delete("/projects/:id(\\d+)/construction-diary/:diaryId(\\d+)", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const diaryId = Number(req.params.diaryId);
    const result = await pool.query("DELETE FROM project_construction_diaries WHERE id = $1 AND project_id = $2", [diaryId, projectId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Construction diary not found" });
    }
    return res.json({ message: "Construction diary deleted" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete construction diary", error: error.message });
  }
});

app.get("/projects/:id(\\d+)/rfx", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const { rows } = await pool.query(
      `SELECT *
       FROM project_rfx_records
       WHERE project_id = $1
       ORDER BY COALESCE(due_date, created_at) DESC, id DESC`,
      [projectId]
    );
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load RFx records", error: error.message });
  }
});

app.post("/projects/:id(\\d+)/rfx", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const { rfxType, title, priority, status, requestedBy, dueDate, resolvedOn, description } = req.body;
    if (!title) {
      return res.status(400).json({ message: "title is required" });
    }

    const { rows } = await pool.query(
      `INSERT INTO project_rfx_records
       (project_id, rfx_type, title, priority, status, requested_by, due_date, resolved_on, description, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
       RETURNING *`,
      [
        projectId,
        String(rfxType || "RFI").toUpperCase(),
        title,
        String(priority || "NORMAL").toUpperCase(),
        status || "OPEN",
        requestedBy || null,
        dueDate || null,
        resolvedOn || null,
        description || null,
        req.user.sub
      ]
    );
    return res.status(201).json(rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to create RFx record", error: error.message });
  }
});

app.put("/projects/:id(\\d+)/rfx/:rfxId(\\d+)", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const rfxId = Number(req.params.rfxId);
    const { rfxType, title, priority, status, requestedBy, dueDate, resolvedOn, description } = req.body;
    const { rows } = await pool.query(
      `UPDATE project_rfx_records
       SET rfx_type = COALESCE($1, rfx_type),
           title = COALESCE($2, title),
           priority = COALESCE($3, priority),
           status = COALESCE($4, status),
           requested_by = COALESCE($5, requested_by),
           due_date = COALESCE($6, due_date),
           resolved_on = COALESCE($7, resolved_on),
           description = COALESCE($8, description),
           updated_by = $9,
           updated_at = NOW()
       WHERE id = $10 AND project_id = $11
       RETURNING *`,
      [
        rfxType ? String(rfxType).toUpperCase() : null,
        title,
        priority ? String(priority).toUpperCase() : null,
        status,
        requestedBy,
        dueDate,
        resolvedOn,
        description,
        req.user.sub,
        rfxId,
        projectId
      ]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: "RFx record not found" });
    }
    return res.json(rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to update RFx record", error: error.message });
  }
});

app.delete("/projects/:id(\\d+)/rfx/:rfxId(\\d+)", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const rfxId = Number(req.params.rfxId);
    const result = await pool.query("DELETE FROM project_rfx_records WHERE id = $1 AND project_id = $2", [rfxId, projectId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "RFx record not found" });
    }
    return res.json({ message: "RFx record deleted" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete RFx record", error: error.message });
  }
});

app.get("/projects/:id(\\d+)/labor-equipment", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const { rows } = await pool.query(
      `SELECT *
       FROM project_resource_allocations
       WHERE project_id = $1
       ORDER BY created_at DESC, id DESC`,
      [projectId]
    );
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load labor/equipment allocations", error: error.message });
  }
});

app.post("/projects/:id(\\d+)/labor-equipment", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const { resourceType, resourceName, quantity, unit, hourlyRate, workingHours, status, note } = req.body;
    if (!resourceName) {
      return res.status(400).json({ message: "resourceName is required" });
    }

    const { rows } = await pool.query(
      `INSERT INTO project_resource_allocations
       (project_id, resource_type, resource_name, quantity, unit, hourly_rate, working_hours, status, note, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10)
       RETURNING *`,
      [
        projectId,
        String(resourceType || "LABOR").toUpperCase(),
        resourceName,
        Number(quantity || 0),
        unit || null,
        Number(hourlyRate || 0),
        Number(workingHours || 0),
        status || "PLANNED",
        note || null,
        req.user.sub
      ]
    );
    return res.status(201).json(rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to create labor/equipment allocation", error: error.message });
  }
});

app.put("/projects/:id(\\d+)/labor-equipment/:itemId(\\d+)", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    const { resourceType, resourceName, quantity, unit, hourlyRate, workingHours, status, note } = req.body;
    const { rows } = await pool.query(
      `UPDATE project_resource_allocations
       SET resource_type = COALESCE($1, resource_type),
           resource_name = COALESCE($2, resource_name),
           quantity = COALESCE($3, quantity),
           unit = COALESCE($4, unit),
           hourly_rate = COALESCE($5, hourly_rate),
           working_hours = COALESCE($6, working_hours),
           status = COALESCE($7, status),
           note = COALESCE($8, note),
           updated_by = $9,
           updated_at = NOW()
       WHERE id = $10 AND project_id = $11
       RETURNING *`,
      [
        resourceType ? String(resourceType).toUpperCase() : null,
        resourceName,
        quantity == null ? null : Number(quantity),
        unit,
        hourlyRate == null ? null : Number(hourlyRate),
        workingHours == null ? null : Number(workingHours),
        status,
        note,
        req.user.sub,
        itemId,
        projectId
      ]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: "Labor/equipment allocation not found" });
    }
    return res.json(rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to update labor/equipment allocation", error: error.message });
  }
});

app.delete("/projects/:id(\\d+)/labor-equipment/:itemId(\\d+)", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const itemId = Number(req.params.itemId);
    const result = await pool.query("DELETE FROM project_resource_allocations WHERE id = $1 AND project_id = $2", [itemId, projectId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Labor/equipment allocation not found" });
    }
    return res.json({ message: "Labor/equipment allocation deleted" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete labor/equipment allocation", error: error.message });
  }
});

app.get("/projects/:id(\\d+)/acceptance", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const { rows } = await pool.query(
      `SELECT *
       FROM project_acceptance_records
       WHERE project_id = $1
       ORDER BY COALESCE(accepted_on, created_at) DESC, id DESC`,
      [projectId]
    );
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load acceptance records", error: error.message });
  }
});

app.post("/projects/:id(\\d+)/acceptance", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const { title, phase, acceptedBy, acceptedOn, status, note } = req.body;
    if (!title) {
      return res.status(400).json({ message: "title is required" });
    }
    const { rows } = await pool.query(
      `INSERT INTO project_acceptance_records
       (project_id, title, phase, accepted_by, accepted_on, status, note, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8)
       RETURNING *`,
      [projectId, title, phase || null, acceptedBy || null, acceptedOn || null, status || "PENDING", note || null, req.user.sub]
    );
    return res.status(201).json(rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to create acceptance record", error: error.message });
  }
});

app.put("/projects/:id(\\d+)/acceptance/:recordId(\\d+)", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const recordId = Number(req.params.recordId);
    const { title, phase, acceptedBy, acceptedOn, status, note } = req.body;
    const { rows } = await pool.query(
      `UPDATE project_acceptance_records
       SET title = COALESCE($1, title),
           phase = COALESCE($2, phase),
           accepted_by = COALESCE($3, accepted_by),
           accepted_on = COALESCE($4, accepted_on),
           status = COALESCE($5, status),
           note = COALESCE($6, note),
           updated_by = $7,
           updated_at = NOW()
       WHERE id = $8 AND project_id = $9
       RETURNING *`,
      [title, phase, acceptedBy, acceptedOn, status, note, req.user.sub, recordId, projectId]
    );
    if (rows.length === 0) {
      return res.status(404).json({ message: "Acceptance record not found" });
    }
    return res.json(rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to update acceptance record", error: error.message });
  }
});

app.delete("/projects/:id(\\d+)/acceptance/:recordId(\\d+)", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);
    const recordId = Number(req.params.recordId);
    const result = await pool.query("DELETE FROM project_acceptance_records WHERE id = $1 AND project_id = $2", [recordId, projectId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Acceptance record not found" });
    }
    return res.json({ message: "Acceptance record deleted" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete acceptance record", error: error.message });
  }
});

app.get("/projects/:id(\\d+)/construction-summary", authenticate, authorize("PROJECT_MANAGER", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const projectId = Number(req.params.id);

    const [planResult, materialResult, resourceResult, costResult, acceptanceResult, timekeepingResult] = await Promise.all([
      pool.query(
        `SELECT
           COUNT(*)::int AS total_items,
           COALESCE(SUM(COALESCE(quantity, 0) * COALESCE(unit_cost, 0)), 0) AS estimated_value,
           COUNT(*) FILTER (WHERE UPPER(COALESCE(status, '')) IN ('DONE', 'COMPLETED'))::int AS completed_items
         FROM project_plan_boq_items
         WHERE project_id = $1`,
        [projectId]
      ),
      pool.query(
        `SELECT
           COUNT(*)::int AS total_items,
           COALESCE(SUM(COALESCE(used_qty, 0) * COALESCE(unit_cost, 0)), 0) AS used_value,
           COALESCE(SUM(COALESCE(planned_qty, 0)), 0) AS planned_qty,
           COALESCE(SUM(COALESCE(received_qty, 0)), 0) AS received_qty,
           COALESCE(SUM(COALESCE(used_qty, 0)), 0) AS used_qty
         FROM project_material_logs
         WHERE project_id = $1`,
        [projectId]
      ),
      pool.query(
        `SELECT
           COUNT(*)::int AS total_items,
           COALESCE(SUM(COALESCE(quantity, 0) * COALESCE(hourly_rate, 0) * COALESCE(working_hours, 0)), 0) AS estimated_value
         FROM project_resource_allocations
         WHERE project_id = $1`,
        [projectId]
      ),
      pool.query(
        `SELECT
           COUNT(*)::int AS total_items,
           COALESCE(SUM(COALESCE(amount, 0)), 0) AS total_cost
         FROM project_cost_entries
         WHERE project_id = $1`,
        [projectId]
      ),
      pool.query(
        `SELECT
           COUNT(*)::int AS total_records,
           COUNT(*) FILTER (WHERE UPPER(COALESCE(status, '')) IN ('APPROVED', 'ACCEPTED', 'DONE'))::int AS approved_records
         FROM project_acceptance_records
         WHERE project_id = $1`,
        [projectId]
      ),
      pool.query(
        `SELECT
           COUNT(*)::int AS total_shifts,
           COUNT(DISTINCT user_id) FILTER (WHERE check_in_time::date = CURRENT_DATE)::int AS active_workers
         FROM attendance_logs
         WHERE project_id = $1`,
        [projectId]
      )
    ]);

    return res.json({
      planBoq: planResult.rows[0],
      materials: materialResult.rows[0],
      resources: resourceResult.rows[0],
      costs: costResult.rows[0],
      acceptance: acceptanceResult.rows[0],
      timekeeping: timekeepingResult.rows[0]
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load construction summary", error: error.message });
  }
});

async function reconcileAllProjectConsistency(db = pool) {
  const { rows } = await db.query("SELECT id FROM projects");
  for (const row of rows) {
    await syncProjectProgressFromStageTasks(Number(row.id), db);
  }
}

ensureConstructionTables()
  .then(async () => {
    await reconcileAllProjectConsistency(pool);
    app.listen(port, () => {
      console.log(`project-service listening on ${port}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize project service:", error.message);
    process.exit(1);
  });


