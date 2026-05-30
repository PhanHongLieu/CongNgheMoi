require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();
const port = Number(process.env.REQUEST_SERVICE_PORT || 3006);

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

app.get("/health", (req, res) => {
  res.json({ service: "request-service", status: "ok" });
});

// Tạo bảng requests nếu chưa tồn tại
async function ensureRequestsTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS requests (
      id SERIAL PRIMARY KEY,
      request_code VARCHAR(20) UNIQUE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      type VARCHAR(40) NOT NULL CHECK (type IN ('leave', 'late', 'overtime', 'forgot_checkout')),
      start_date DATE,
      end_date DATE,
      request_date DATE,
      request_shift VARCHAR(30),
      hours NUMERIC(5,2),
      reason TEXT NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED')),
      approved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      reviewer_note TEXT,
      approved_at TIMESTAMP,
      attachment_url TEXT,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query("ALTER TABLE requests ADD COLUMN IF NOT EXISTS request_code VARCHAR(20)");
  await pool.query("ALTER TABLE requests ADD COLUMN IF NOT EXISTS project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL");
  await pool.query("ALTER TABLE requests ADD COLUMN IF NOT EXISTS request_date DATE");
  await pool.query("ALTER TABLE requests ADD COLUMN IF NOT EXISTS request_shift VARCHAR(30)");
  await pool.query("ALTER TABLE requests ADD COLUMN IF NOT EXISTS reviewer_note TEXT");
  await pool.query("ALTER TABLE requests ADD COLUMN IF NOT EXISTS attachment_url TEXT");
  await pool.query("ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_type_check");
  await pool.query("ALTER TABLE requests ADD CONSTRAINT requests_type_check CHECK (type IN ('leave', 'late', 'overtime', 'forgot_checkout'))");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_code_unique ON requests(request_code) WHERE request_code IS NOT NULL");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_requests_project_id ON requests(project_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_requests_request_date ON requests(request_date)");
  await pool.query(`
    UPDATE requests
    SET request_code = CONCAT('REQ-', TO_CHAR(created_at, 'YYYYMMDD'), '-', LPAD(id::text, 6, '0'))
    WHERE request_code IS NULL
  `);

  await pool.query("CREATE INDEX IF NOT EXISTS idx_requests_user_id ON requests(user_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_requests_type ON requests(type)");
}

ensureRequestsTable().catch(console.error);

function parseCheckoutTimeFromReason(reasonText) {
  const text = String(reasonText || "");
  const match = text.match(/(\d{1,2}):(\d{2})/);
  if (!match) return null;
  const hh = Number(match[1]);
  const mm = Number(match[2]);
  if (!Number.isInteger(hh) || !Number.isInteger(mm) || hh < 0 || hh > 23 || mm < 0 || mm > 59) {
    return null;
  }
  return { hh, mm };
}

async function applyForgotCheckoutApproval(requestRow, approverId) {
  const requestDate = requestRow.request_date || requestRow.start_date;
  if (!requestDate) return;
  const parsed = parseCheckoutTimeFromReason(requestRow.reason);
  if (!parsed) return;

  const checkoutTs = `${requestDate} ${String(parsed.hh).padStart(2, "0")}:${String(parsed.mm).padStart(2, "0")}:00`;
  const updated = await pool.query(
    `UPDATE attendance_logs
     SET check_out_time = COALESCE(check_out_time, $1::timestamp),
         attendance_status = CASE WHEN COALESCE(check_out_time, $1::timestamp) IS NOT NULL THEN 'COMPLETED' ELSE attendance_status END,
         note = CONCAT(COALESCE(note, ''), CASE WHEN COALESCE(note,'') = '' THEN '' ELSE ' | ' END, 'Approved forgot checkout by user ', $2::text, ' via request ', $3::text),
         updated_at = NOW()
     WHERE user_id = $4
       AND DATE(check_in_time) = $5::date
       AND (check_out_time IS NULL OR attendance_status = 'MISSING_OUT')
     RETURNING id, user_id, project_id, check_in_time, check_out_time`,
    [checkoutTs, approverId, requestRow.id, requestRow.user_id, requestDate]
  );

  for (const row of updated.rows) {
    const rawHours = Math.max((new Date(row.check_out_time).getTime() - new Date(row.check_in_time).getTime()) / 3600000, 0);
    const breakHours = rawHours >= 6 ? 1.5 : 0;
    const actualHours = Math.max(rawHours - breakHours, 0);
    const workingDayValue = actualHours >= 8 ? 1 : actualHours >= 4 ? 0.5 : 0;
    const otHours = actualHours > 8 ? actualHours - 8 : 0;
    await pool.query(
      `INSERT INTO timesheets
       (attendance_log_id, user_id, project_id, work_date, check_in_time, check_out_time, raw_work_hours, break_hours, actual_hours, working_day_value, ot_hours, timesheet_status, source, locked_by_request_id, notes, computed_at, updated_at)
       VALUES ($1,$2,$3,DATE($4::timestamp),$4,$5,$6,$7,$8,$9,$10,'READY','REQUEST_OVERRIDE',$11,$12,NOW(),NOW())
       ON CONFLICT (attendance_log_id)
       DO UPDATE SET
         check_out_time = EXCLUDED.check_out_time,
         raw_work_hours = EXCLUDED.raw_work_hours,
         break_hours = EXCLUDED.break_hours,
         actual_hours = EXCLUDED.actual_hours,
         working_day_value = EXCLUDED.working_day_value,
         ot_hours = EXCLUDED.ot_hours,
         timesheet_status = EXCLUDED.timesheet_status,
         source = EXCLUDED.source,
         locked_by_request_id = EXCLUDED.locked_by_request_id,
         notes = EXCLUDED.notes,
         updated_at = NOW()`,
      [row.id, row.user_id, row.project_id, row.check_in_time, row.check_out_time, Number(rawHours.toFixed(2)), Number(breakHours.toFixed(2)), Number(actualHours.toFixed(2)), Number(workingDayValue.toFixed(2)), Number(otHours.toFixed(2)), requestRow.id, `Approved forgot checkout request ${requestRow.id}`]
    );
  }
}

// Lấy danh sách đơn từ của người dùng hiện tại
app.get("/requests/my", authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT r.*, u.full_name as user_name, p.name AS project_name
       FROM requests r 
       JOIN users u ON r.user_id = u.id 
       LEFT JOIN projects p ON r.project_id = p.id
       WHERE r.user_id = $1 
       ORDER BY r.created_at DESC`,
      [req.user.sub]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch requests", error: error.message });
  }
});

// Lấy danh sách tất cả đơn từ (cho HR/Manager)
app.get("/requests", authenticate, async (req, res) => {
  try {
    const { status, type } = req.query;
    let query = `
      SELECT r.*, u.full_name as user_name, u.employee_code, p.name AS project_name
      FROM requests r 
      JOIN users u ON r.user_id = u.id
      LEFT JOIN projects p ON r.project_id = p.id
    `;
    const params = [];
    const conditions = [];

    if (status) {
      conditions.push(`r.status = $${params.length + 1}`);
      params.push(status);
    }

    if (type) {
      conditions.push(`r.type = $${params.length + 1}`);
      params.push(type);
    }

    if (conditions.length > 0) {
      query += " WHERE " + conditions.join(" AND ");
    }

    query += " ORDER BY r.created_at DESC";

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch requests", error: error.message });
  }
});

// Tạo đơn mới
app.post("/requests", authenticate, async (req, res) => {
  try {
    const { type, start_date, end_date, request_date, request_shift, project_id, hours, reason, attachment_url } = req.body;

    if (!type || !reason) {
      return res.status(400).json({ message: "Missing required fields" });
    }
    const projectId = project_id ? Number(project_id) : null;
    if (project_id != null && !Number.isFinite(projectId)) {
      return res.status(400).json({ message: "project_id must be a number" });
    }

    const { rows } = await pool.query(
      `WITH inserted AS (
         INSERT INTO requests (user_id, project_id, type, start_date, end_date, request_date, request_shift, hours, reason, attachment_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         RETURNING *
       )
       UPDATE requests r
       SET request_code = CONCAT('REQ-', TO_CHAR(NOW(), 'YYYYMMDD'), '-', LPAD(inserted.id::text, 6, '0'))
       FROM inserted
       WHERE r.id = inserted.id
       RETURNING r.*`,
      [req.user.sub, projectId, type, start_date || null, end_date || null, request_date || null, request_shift || null, hours || null, reason, attachment_url || null]
    );

    res.status(201).json(rows[0]);
  } catch (error) {
    res.status(500).json({ message: "Failed to create request", error: error.message });
  }
});

// Duyệt/Từ chối đơn
app.put("/requests/:id/status", authenticate, async (req, res) => {
  try {
    const { status, reviewer_note } = req.body;
    const requestId = Number(req.params.id);

    if (!status || !["APPROVED", "REJECTED"].includes(status)) {
      return res.status(400).json({ message: "Invalid status" });
    }

    const requestResult = await pool.query("SELECT * FROM requests WHERE id = $1", [requestId]);
    if (requestResult.rows.length === 0) {
      return res.status(404).json({ message: "Request not found" });
    }
    const requestRow = requestResult.rows[0];

    const { rows } = await pool.query(
      `UPDATE requests 
       SET status = $1, approved_by = $2, approved_at = NOW(), reviewer_note = $3, updated_at = NOW()
       WHERE id = $4
       RETURNING *`,
      [status, req.user.sub, reviewer_note || null, requestId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Request not found" });
    }

    if (status === "APPROVED" && requestRow.type === "forgot_checkout") {
      await applyForgotCheckoutApproval(requestRow, req.user.sub);
    }

    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ message: "Failed to update request status", error: error.message });
  }
});

// Lấy chi tiết đơn
app.get("/requests/:id", authenticate, async (req, res) => {
  try {
    const requestId = Number(req.params.id);
    const { rows } = await pool.query(
      `SELECT r.*, u.full_name as user_name, u.employee_code, p.name AS project_name,
              approver.full_name as approver_name
       FROM requests r 
       JOIN users u ON r.user_id = u.id 
       LEFT JOIN projects p ON r.project_id = p.id
       LEFT JOIN users approver ON r.approved_by = approver.id
       WHERE r.id = $1`,
      [requestId]
    );

    if (rows.length === 0) {
      return res.status(404).json({ message: "Request not found" });
    }

    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ message: "Failed to fetch request", error: error.message });
  }
});

app.listen(port, () => {
  console.log(`Request service running on port ${port}`);
});
