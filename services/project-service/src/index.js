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

app.use(helmet());
app.use(cors());
app.use(express.json());

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
      `SELECT p.*, pa.assignment_role, pa.work_start, pa.work_end
       FROM project_assignments pa
       JOIN projects p ON pa.project_id = p.id
       WHERE pa.user_id = $1
       ORDER BY p.created_at DESC`,
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
      `SELECT pa.*, p.name AS project_name, p.address, p.status AS project_status
       FROM project_assignments pa
       JOIN projects p ON pa.project_id = p.id
       WHERE pa.user_id = $1
       ORDER BY pa.work_start DESC`,
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

    const result = await pool.query(
      `INSERT INTO projects (project_code, name, address, latitude, longitude, start_date, end_date, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING *`,
      [projectCode, name, address || null, latitude, longitude, startDate || null, endDate || null, status || "PLANNING"]
    );

    await writeDataLog({
      action: "create",
      collection: "project",
      recordId: String(result.rows[0].id),
      username: req.user.email,
      metadata: { projectCode: result.rows[0].project_code, status: result.rows[0].status }
    });

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to create project", error: error.message });
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
      `SELECT pa.id, pa.user_id, pa.project_id, pa.assignment_role, pa.work_start, pa.work_end,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.last_name, u.first_name)), ''), u.full_name) AS full_name,
              u.employee_code, p.name AS project_name
       FROM project_assignments pa
       JOIN users u ON pa.user_id = u.id
       JOIN projects p ON pa.project_id = p.id
       WHERE pa.project_id = $1`,
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
    const { userId, projectId, assignmentRole, workStart, workEnd } = req.body;
    if (!userId || !projectId) {
      return res.status(400).json({ message: "userId and projectId are required" });
    }

    const result = await pool.query(
      `INSERT INTO project_assignments (user_id, project_id, assignment_role, work_start, work_end)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (user_id, project_id)
       DO UPDATE SET
         assignment_role = EXCLUDED.assignment_role,
         work_start = EXCLUDED.work_start,
         work_end = EXCLUDED.work_end
       RETURNING *`,
      [userId, projectId, assignmentRole || null, workStart || null, workEnd || null]
    );

    await writeDataLog({
      action: "create",
      collection: "project-assignment",
      recordId: String(result.rows[0].id),
      username: req.user.email,
      metadata: { userId, projectId }
    });

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to assign employee", error: error.message });
  }
});

app.delete("/projects/assignments/:id", authenticate, authorize("PROJECT_MANAGER"), async (req, res) => {
  try {
    const assignmentId = Number(req.params.id);
    const target = await pool.query("SELECT user_id, project_id FROM project_assignments WHERE id = $1", [assignmentId]);
    const result = await pool.query("DELETE FROM project_assignments WHERE id = $1", [assignmentId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Assignment not found" });
    }

    await writeDataLog({
      action: "delete",
      collection: "project-assignment",
      recordId: String(assignmentId),
      username: req.user.email,
      metadata: {
        userId: target.rows[0]?.user_id || null,
        projectId: target.rows[0]?.project_id || null
      }
    });

    return res.json({ message: "Assignment removed" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to remove assignment", error: error.message });
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
       SET status = CASE
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
    return res.status(500).json({ message: "Failed to update project progress", error: error.message });
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

app.listen(port, () => {
  console.log(`project-service listening on ${port}`);
});

