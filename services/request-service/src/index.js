require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();
const port = Number(process.env.PORT || process.env.REQUEST_SERVICE_PORT || 3006);

const dbConfig = process.env.DATABASE_URL
  ? {
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined
    }
  : {
      host: process.env.POSTGRES_HOST || "localhost",
      port: Number(process.env.POSTGRES_PORT || 6543),
      database: process.env.POSTGRES_DB || "mdp_system",
      user: process.env.POSTGRES_USER || "mdp_user",
      password: process.env.POSTGRES_PASSWORD || "mdp_password"
    };
const pool = new Pool(dbConfig);

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "change_access_secret";
const TOKEN_ISSUER = process.env.TOKEN_ISSUER || "mdp-system";

app.use(helmet());
app.use(cors());
app.use(express.json());

const REQUEST_TYPES = ["MISSED_PUNCH", "LEAVE", "OT"];
const REQUEST_STATUSES = ["PENDING", "APPROVED", "REJECTED"];

function roleOf(user) {
  return String(user?.role || "").toUpperCase();
}

function canReviewRequest(userRole, requestType) {
  if (["ADMIN", "MANAGER"].includes(userRole)) return true;
  if (requestType === "LEAVE") return userRole === "HR_MANAGER";
  if (["MISSED_PUNCH", "OT"].includes(requestType)) return userRole === "PROJECT_MANAGER";
  return false;
}

function reviewerRolesForRequest(requestType) {
  const normalized = String(requestType || "").toUpperCase();
  if (normalized === "LEAVE") return ["HR_MANAGER"];
  if (["MISSED_PUNCH", "OT"].includes(normalized)) return ["PROJECT_MANAGER"];
  return ["HR_MANAGER", "PROJECT_MANAGER"];
}

async function createNotification({ userId, senderUserId, title, message, notificationType = "SYSTEM", priority = "NORMAL", actionUrl = null }, db = pool) {
  if (!userId || !title || !message) return;
  await db.query("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS sender_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL");
  await db.query("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS action_url TEXT");
  await db.query("ALTER TABLE notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMP");
  await db.query(
    `INSERT INTO notifications (user_id, sender_user_id, notification_type, priority, title, message, action_url, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'UNREAD')`,
    [
      Number(userId),
      senderUserId || null,
      String(notificationType).slice(0, 40).toUpperCase(),
      String(priority).slice(0, 20).toUpperCase(),
      title,
      message,
      actionUrl
    ]
  );
}

async function notifyRoles(roles, notification, db = pool) {
  const normalizedRoles = (Array.isArray(roles) ? roles : [roles]).map((role) => String(role || "").toUpperCase()).filter(Boolean);
  if (normalizedRoles.length === 0) return;
  const { rows } = await db.query(
    `SELECT DISTINCT u.id
     FROM users u
     JOIN accounts a ON a.user_id = u.id
     WHERE a.role = ANY($1::text[])
       AND a.account_status = 'ACTIVE'
       AND COALESCE(u.status, 'WORKING') = 'WORKING'`,
    [normalizedRoles]
  );
  for (const row of rows) {
    await createNotification({ ...notification, userId: row.id }, db);
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
      type VARCHAR(40) NOT NULL,
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
      request_meta JSONB,
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
  await pool.query("ALTER TABLE requests ADD COLUMN IF NOT EXISTS request_meta JSONB");
  await pool.query("ALTER TABLE requests DROP CONSTRAINT IF EXISTS requests_type_check");
  await pool.query(`UPDATE requests SET type = CASE
    WHEN LOWER(type) IN ('forgot_checkout') THEN 'MISSED_PUNCH'
    WHEN LOWER(type) IN ('overtime') THEN 'OT'
    WHEN LOWER(type) IN ('leave') THEN 'LEAVE'
    ELSE UPPER(type)
  END`);
  await pool.query(`ALTER TABLE requests ADD CONSTRAINT requests_type_check CHECK (type IN ('MISSED_PUNCH', 'LEAVE', 'OT'))`);
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

async function upsertTimesheetFromAttendance(attendanceRow, requestId, note) {
  const rawHours = Math.max((new Date(attendanceRow.check_out_time).getTime() - new Date(attendanceRow.check_in_time).getTime()) / 3600000, 0);
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
       check_in_time = EXCLUDED.check_in_time,
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
    [attendanceRow.id, attendanceRow.user_id, attendanceRow.project_id, attendanceRow.check_in_time, attendanceRow.check_out_time, Number(rawHours.toFixed(2)), Number(breakHours.toFixed(2)), Number(actualHours.toFixed(2)), Number(workingDayValue.toFixed(2)), Number(otHours.toFixed(2)), requestId, note]
  );
}

async function applyMissedPunchApproval(requestRow, approverId) {
  const meta = requestRow.request_meta || {};
  const requestDate = requestRow.request_date || requestRow.start_date || meta.requestDate;
  if (!requestDate) return;
  const checkInText = String(meta.actualCheckIn || "").trim();
  const checkOutText = String(meta.actualCheckOut || "").trim();

  const checkInTs = checkInText ? `${requestDate} ${checkInText}:00` : null;
  const checkOutTs = checkOutText ? `${requestDate} ${checkOutText}:00` : null;
  const updated = await pool.query(
    `UPDATE attendance_logs
     SET check_in_time = COALESCE(check_in_time, $1::timestamp),
         check_out_time = COALESCE(check_out_time, $2::timestamp),
         attendance_status = CASE
           WHEN COALESCE(check_in_time, $1::timestamp) IS NOT NULL AND COALESCE(check_out_time, $2::timestamp) IS NOT NULL THEN 'COMPLETED'
           ELSE attendance_status
         END,
         note = CONCAT(COALESCE(note, ''), CASE WHEN COALESCE(note,'') = '' THEN '' ELSE ' | ' END, 'Approved forgot checkout by user ', $2::text, ' via request ', $3::text),
         updated_at = NOW()
     WHERE user_id = $4
       AND DATE(COALESCE(check_in_time, $1::timestamp, $2::timestamp)) = $5::date
       AND (check_in_time IS NULL OR check_out_time IS NULL OR attendance_status IN ('MISSING_IN', 'MISSING_OUT', 'INVALID', 'OPEN'))
     RETURNING id, user_id, project_id, check_in_time, check_out_time`,
    [checkInTs, checkOutTs, approverId, requestRow.id, requestRow.user_id, requestDate]
  );

  for (const row of updated.rows) {
    if (row.check_in_time && row.check_out_time) {
      await upsertTimesheetFromAttendance(row, requestRow.id, `Approved missed punch request ${requestRow.id}`);
    }
  }
}

async function applyLeaveApproval(requestRow) {
  const meta = requestRow.request_meta || {};
  const startDate = requestRow.start_date || meta.startDate;
  const endDate = requestRow.end_date || requestRow.start_date || meta.endDate || startDate;
  if (!startDate) return;
  await pool.query(
    `UPDATE employee_work_schedules
     SET status = 'LEAVE',
         updated_at = NOW()
     WHERE user_id = $1
       AND work_date BETWEEN $2::date AND $3::date
       AND status <> 'CANCELLED'`,
    [requestRow.user_id, startDate, endDate]
  );
}

async function applyOtApproval(requestRow) {
  const meta = requestRow.request_meta || {};
  const requestDate = requestRow.request_date || requestRow.start_date || meta.requestDate;
  const approvedHours = Number(meta.otHours ?? requestRow.hours ?? 0);
  if (!requestDate || !Number.isFinite(approvedHours) || approvedHours <= 0) return;
  await pool.query(
    `UPDATE timesheets
     SET ot_hours = $1,
         timesheet_status = 'READY',
         updated_at = NOW(),
         notes = CONCAT(COALESCE(notes,''), CASE WHEN COALESCE(notes,'')='' THEN '' ELSE ' | ' END, 'OT approved via request ', $2::text)
     WHERE user_id = $3
       AND work_date = $4::date`,
    [approvedHours, requestRow.id, requestRow.user_id, requestDate]
  );
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
    const { type, start_date, end_date, request_date, request_shift, project_id, hours, reason, attachment_url, request_meta } = req.body;
    const normalizedType = String(type || "").trim().toUpperCase();

    if (!REQUEST_TYPES.includes(normalizedType) || !reason) {
      return res.status(400).json({ message: "Missing required fields" });
    }
    const projectId = project_id ? Number(project_id) : null;
    if (project_id != null && !Number.isFinite(projectId)) {
      return res.status(400).json({ message: "project_id must be a number" });
    }

    if (normalizedType === "LEAVE") {
      const checkDate = start_date || request_date;
      if (checkDate) {
        const dateObj = new Date(`${checkDate}T00:00:00`);
        const day = dateObj.getDay();
        if (day === 0) {
          return res.status(400).json({ message: "This is a standard day off, leave request is not required." });
        }
        const dayOffCheck = await pool.query(
          `SELECT id
           FROM employee_work_schedules
           WHERE user_id = $1
             AND work_date = $2::date
             AND status IN ('DAY_OFF', 'LEAVE')
           LIMIT 1`,
          [req.user.sub, checkDate]
        );
        if (dayOffCheck.rows.length > 0) {
          return res.status(400).json({ message: "This is a standard day off, leave request is not required." });
        }
      }
    }

    const inserted = await pool.query(
      `INSERT INTO requests (user_id, project_id, type, start_date, end_date, request_date, request_shift, hours, reason, attachment_url, request_meta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb)
       RETURNING *`,
      [req.user.sub, projectId, normalizedType, start_date || null, end_date || null, request_date || null, request_shift || null, hours || null, reason, attachment_url || null, JSON.stringify(request_meta || {})]
    );
    const { rows } = await pool.query(
      `UPDATE requests
       SET request_code = CONCAT('REQ-', TO_CHAR(created_at, 'YYYYMMDD'), '-', LPAD(id::text, 6, '0')),
           updated_at = NOW()
       WHERE id = $1
       RETURNING *`,
      [inserted.rows[0].id]
    );

    await notifyRoles(reviewerRolesForRequest(normalizedType), {
      senderUserId: req.user.sub,
      title: "New request pending review",
      message: `${rows[0].request_code || `Request #${rows[0].id}`} (${normalizedType}) is waiting for your review.`,
      notificationType: "REQUEST",
      priority: normalizedType === "MISSED_PUNCH" ? "HIGH" : "NORMAL",
      actionUrl: "/requests"
    });

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
    const userRole = roleOf(req.user);
    if (!canReviewRequest(userRole, String(requestRow.type || "").toUpperCase())) {
      return res.status(403).json({ message: "Forbidden: you are not allowed to review this request type." });
    }

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

    const requestType = String(requestRow.type || "").toUpperCase();
    if (status === "APPROVED" && requestType === "MISSED_PUNCH") {
      await applyMissedPunchApproval(requestRow, req.user.sub);
    }
    if (status === "APPROVED" && requestType === "LEAVE") {
      await applyLeaveApproval(requestRow);
    }
    if (status === "APPROVED" && requestType === "OT") {
      await applyOtApproval(requestRow);
    }

    await createNotification({
      userId: requestRow.user_id,
      senderUserId: req.user.sub,
      title: `Request ${status.toLowerCase()}`,
      message: `${requestRow.request_code || `Request #${requestRow.id}`} (${requestType}) was ${status.toLowerCase()}${reviewer_note ? `: ${reviewer_note}` : "."}`,
      notificationType: "REQUEST",
      priority: status === "REJECTED" ? "HIGH" : "NORMAL",
      actionUrl: "/requests/my"
    });

    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ message: "Failed to update request status", error: error.message });
  }
});

app.get("/requests/missed-attendance-options", authenticate, async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT DISTINCT DATE(check_in_time) AS work_date, attendance_status
       FROM attendance_logs
       WHERE user_id = $1
         AND DATE(check_in_time) >= CURRENT_DATE - INTERVAL '7 days'
         AND attendance_status IN ('MISSING_IN', 'MISSING_OUT', 'INVALID', 'OPEN')
       ORDER BY work_date DESC`,
      [req.user.sub]
    );
    res.json(rows.map((row) => ({ workDate: row.work_date, status: row.attendance_status })));
  } catch (error) {
    res.status(500).json({ message: "Failed to load missed attendance options", error: error.message });
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
