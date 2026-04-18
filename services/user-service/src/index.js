require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const app = express();
const port = Number(process.env.USER_SERVICE_PORT || 3002);

const pool = new Pool({
  host: process.env.POSTGRES_HOST || "localhost",
  port: Number(process.env.POSTGRES_PORT || 6543),
  database: process.env.POSTGRES_DB || "mdp_system",
  user: process.env.POSTGRES_USER || "mdp_user",
  password: process.env.POSTGRES_PASSWORD || "mdp_password"
});

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "change_access_secret";
const TOKEN_ISSUER = process.env.TOKEN_ISSUER || "mdp-system";
const DEFAULT_NEW_USER_PASSWORD = "123456";
const EMPLOYMENT_STATUSES = ["WORKING", "RESIGNED"];
const DEFAULT_MONTHLY_STANDARD_HOURS = Number(process.env.SALARY_STANDARD_HOURS || 208);
const DEFAULT_HOURLY_RATE = Number(process.env.SALARY_HOURLY_RATE || 35000);
const DEFAULT_OVERTIME_MULTIPLIER = Number(process.env.SALARY_OVERTIME_MULTIPLIER || 1.5);
const BUSINESS_START_HOUR = Number(process.env.SALARY_BUSINESS_START_HOUR || 8);
const LUNCH_START_HOUR = Number(process.env.SALARY_LUNCH_START_HOUR || 12);
const LUNCH_END_HOUR = Number(process.env.SALARY_LUNCH_END_HOUR || 13);
const BUSINESS_END_HOUR = Number(process.env.SALARY_BUSINESS_END_HOUR || 17);
const HOLIDAY_MODES = ["exclude", "multiplier"];
const DEFAULT_HOLIDAY_MODE = String(process.env.SALARY_HOLIDAY_MODE || "exclude").trim().toLowerCase();

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "10mb" }));

async function writeDataLog({ action, collection, recordId, username, metadata }) {
  try {
    await pool.query(
      `INSERT INTO data_logs (service_name, action, collection, record_id, username, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ["user-service", action, collection, recordId || null, username || null, metadata || null]
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

function normalizeBirthDate(input) {
  if (input === undefined) {
    return undefined;
  }
  if (input === null || input === "") {
    return null;
  }
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return NaN;
  }
  return date.toISOString().slice(0, 10);
}

function normalizeNameInput(firstName, lastName, fullName) {
  const fn = String(firstName || "").trim();
  const ln = String(lastName || "").trim();
  if (fn || ln) {
    return { firstName: fn, lastName: ln };
  }

  const legacy = String(fullName || "").trim();
  if (!legacy) {
    return { firstName: "", lastName: "" };
  }

  const parts = legacy.split(/\s+/);
  const detectedFirstName = parts.pop() || "";
  return {
    firstName: detectedFirstName,
    lastName: parts.join(" ").trim()
  };
}

function normalizeFaceTemplatePayload(input) {
  const raw = String(input || "").trim();
  if (!raw) {
    return { error: "faceTemplate is required" };
  }

  if (!raw.startsWith("{")) {
    return { value: raw, metadata: { mode: "raw", sampleCount: 0, version: null } };
  }

  try {
    const parsed = JSON.parse(raw);
    const primaryTemplate = String(parsed?.primaryTemplate || "").trim();
    const primaryEmbedding = normalizeEmbeddingVector(parsed?.primaryEmbedding);
    if (!primaryTemplate && primaryEmbedding.length === 0) {
      return { error: "faceTemplate requires primaryTemplate or primaryEmbedding" };
    }

    const samples = parsed && typeof parsed.samples === "object" && parsed.samples !== null ? parsed.samples : {};
    const signatures = parsed && typeof parsed.signatures === "object" && parsed.signatures !== null ? parsed.signatures : {};
    const embeddingsInput = parsed && typeof parsed.embeddings === "object" && parsed.embeddings !== null ? parsed.embeddings : {};
    const normalizedEmbeddings = {};
    for (const [key, value] of Object.entries(embeddingsInput)) {
      const normalizedItem = normalizeEmbeddingVector(value);
      if (normalizedItem.length > 0) {
        normalizedEmbeddings[key] = normalizedItem;
      }
    }

    const embeddingDim = Number(parsed?.embeddingDim);
    const resolvedEmbeddingDim =
      embeddingDim === 128 || embeddingDim === 512
        ? embeddingDim
        : primaryEmbedding.length === 512
          ? 512
          : 128;

    if (primaryEmbedding.length > 0 && primaryEmbedding.length !== resolvedEmbeddingDim) {
      return { error: `faceTemplate.primaryEmbedding must have ${resolvedEmbeddingDim} values` };
    }

    for (const item of Object.values(normalizedEmbeddings)) {
      if (item.length !== resolvedEmbeddingDim) {
        return { error: `faceTemplate.embeddings must have ${resolvedEmbeddingDim} values per sample` };
      }
    }

    const normalized = {
      version: Number.isFinite(Number(parsed.version)) ? Number(parsed.version) : 3,
      capturedAt: parsed.capturedAt || new Date().toISOString(),
      primaryTemplate,
      primarySignature: String(parsed?.primarySignature || "").trim(),
      primaryEmbedding,
      embeddingDim: resolvedEmbeddingDim,
      samples,
      signatures,
      embeddings: normalizedEmbeddings,
      livenessProfile: parsed?.livenessProfile && typeof parsed.livenessProfile === "object" ? parsed.livenessProfile : null
    };

    return {
      value: JSON.stringify(normalized),
      metadata: {
        mode: "json",
        sampleCount: Object.keys(samples).length,
        version: normalized.version,
        embeddingDim: normalized.embeddingDim,
        hasEmbedding: primaryEmbedding.length > 0
      }
    };
  } catch {
    return { error: "faceTemplate must be valid JSON or raw image string" };
  }
}

function normalizeEmbeddingVector(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  const cleaned = input
    .map((item) => Number(item))
    .filter((item) => Number.isFinite(item));
  if (cleaned.length !== 128 && cleaned.length !== 512) {
    return [];
  }
  return cleaned.map((item) => Number(item.toFixed(6)));
}

function toNumber(input) {
  const value = Number(input);
  return Number.isFinite(value) ? value : null;
}

function normalizeDateOnly(input) {
  if (input == null) {
    return null;
  }
  const raw = String(input).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    return null;
  }
  const parsed = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString().slice(0, 10) === raw ? raw : null;
}

function roundMoney(value) {
  return Number(Number(value || 0).toFixed(2));
}

function normalizeHolidayMode(input) {
  const mode = String(input || DEFAULT_HOLIDAY_MODE).trim().toLowerCase();
  return HOLIDAY_MODES.includes(mode) ? mode : "exclude";
}

function buildAttendanceMetricsQuery(includeUserFilter) {
  const userFilterClause = includeUserFilter ? "AND a.user_id = $7" : "";
  return `WITH valid_logs AS (
            SELECT
              a.user_id,
              GREATEST(a.check_in_time, COALESCE(pa.work_start, a.check_in_time), $1::timestamp) AS start_at,
              LEAST(a.check_out_time, COALESCE(pa.work_end, a.check_out_time), $2::timestamp) AS end_at
            FROM attendance_logs a
            JOIN project_assignments pa
              ON pa.user_id = a.user_id
             AND pa.project_id = a.project_id
            WHERE a.check_in_time IS NOT NULL
              AND a.check_out_time IS NOT NULL
              AND a.check_out_time > a.check_in_time
              AND a.check_in_time < $2::timestamp
              AND a.check_out_time > $1::timestamp
              ${userFilterClause}
          ),
          expanded AS (
            SELECT
              v.user_id,
              gs.day_start,
              GREATEST(v.start_at, gs.day_start) AS segment_start,
              LEAST(v.end_at, gs.day_start + INTERVAL '1 day') AS segment_end
            FROM valid_logs v
            CROSS JOIN LATERAL generate_series(
              date_trunc('day', v.start_at),
              date_trunc('day', v.end_at),
              INTERVAL '1 day'
            ) AS gs(day_start)
          ),
          segments AS (
            SELECT
              user_id,
              day_start::date AS work_day,
              segment_start,
              segment_end
            FROM expanded
            WHERE segment_end > segment_start
          ),
          per_segment AS (
            SELECT
              s.user_id,
              s.work_day,
              EXTRACT(EPOCH FROM (s.segment_end - s.segment_start)) / 3600.0 AS total_hours,
              GREATEST(
                EXTRACT(EPOCH FROM (
                  LEAST(
                    s.segment_end,
                    s.work_day::timestamp + make_interval(hours => $4)
                  ) - GREATEST(
                    s.segment_start,
                    s.work_day::timestamp + make_interval(hours => $3)
                  )
                )) / 3600.0,
                0
              )
              +
              GREATEST(
                EXTRACT(EPOCH FROM (
                  LEAST(
                    s.segment_end,
                    s.work_day::timestamp + make_interval(hours => $6)
                  ) - GREATEST(
                    s.segment_start,
                    s.work_day::timestamp + make_interval(hours => $5)
                  )
                )) / 3600.0,
                0
              ) AS regular_hours,
              GREATEST(
                EXTRACT(EPOCH FROM (
                  LEAST(
                    s.segment_end,
                    s.work_day::timestamp + make_interval(hours => $5)
                  ) - GREATEST(
                    s.segment_start,
                    s.work_day::timestamp + make_interval(hours => $4)
                  )
                )) / 3600.0,
                0
              ) AS lunch_hours
            FROM segments s
          ),
          per_day AS (
            SELECT
              user_id,
              work_day,
              SUM(total_hours) AS total_hours,
              SUM(regular_hours) AS regular_hours,
              SUM(lunch_hours) AS lunch_hours
            FROM per_segment
            GROUP BY user_id, work_day
          ),
          classified AS (
            SELECT
              pd.user_id,
              pd.work_day,
              LEAST(pd.regular_hours, GREATEST(pd.total_hours - pd.lunch_hours, 0)) AS worked_hours,
              GREATEST(pd.total_hours - pd.lunch_hours - LEAST(pd.regular_hours, GREATEST(pd.total_hours - pd.lunch_hours, 0)), 0) AS overtime_hours,
              h.multiplier AS holiday_multiplier
            FROM per_day pd
            LEFT JOIN holidays h
              ON h.holiday_date = pd.work_day
             AND h.is_active = TRUE
          ),
          aggregated AS (
            SELECT
              user_id,
              ROUND(SUM(CASE WHEN holiday_multiplier IS NULL THEN worked_hours ELSE 0 END)::numeric, 2) AS non_holiday_worked_hours,
              ROUND(SUM(CASE WHEN holiday_multiplier IS NULL THEN overtime_hours ELSE 0 END)::numeric, 2) AS non_holiday_overtime_hours,
              ROUND(SUM(CASE WHEN holiday_multiplier IS NOT NULL THEN worked_hours ELSE 0 END)::numeric, 2) AS holiday_worked_hours,
              ROUND(SUM(CASE WHEN holiday_multiplier IS NOT NULL THEN overtime_hours ELSE 0 END)::numeric, 2) AS holiday_overtime_hours,
              ROUND(SUM(CASE WHEN holiday_multiplier IS NOT NULL THEN worked_hours * COALESCE(holiday_multiplier, 1) ELSE 0 END)::numeric, 2) AS holiday_weighted_worked_hours,
              ROUND(SUM(CASE WHEN holiday_multiplier IS NOT NULL THEN overtime_hours * COALESCE(holiday_multiplier, 1) ELSE 0 END)::numeric, 2) AS holiday_weighted_overtime_hours
            FROM classified
            GROUP BY user_id
          ),
          invalid AS (
            SELECT
              a.user_id,
              COUNT(*)::int AS missing_logs
            FROM attendance_logs a
            JOIN project_assignments pa
              ON pa.user_id = a.user_id
             AND pa.project_id = a.project_id
            WHERE (
                a.check_in_time IS NULL
                OR a.check_out_time IS NULL
                OR a.check_out_time <= a.check_in_time
              )
              AND COALESCE(a.check_in_time, a.check_out_time) < $2::timestamp
              AND COALESCE(a.check_out_time, a.check_in_time, $1::timestamp) > $1::timestamp
              ${userFilterClause}
            GROUP BY a.user_id
          )
          SELECT
            COALESCE(ag.user_id, iv.user_id) AS user_id,
            COALESCE(ag.non_holiday_worked_hours, 0) AS non_holiday_worked_hours,
            COALESCE(ag.non_holiday_overtime_hours, 0) AS non_holiday_overtime_hours,
            COALESCE(ag.holiday_worked_hours, 0) AS holiday_worked_hours,
            COALESCE(ag.holiday_overtime_hours, 0) AS holiday_overtime_hours,
            COALESCE(ag.holiday_weighted_worked_hours, 0) AS holiday_weighted_worked_hours,
            COALESCE(ag.holiday_weighted_overtime_hours, 0) AS holiday_weighted_overtime_hours,
            COALESCE(iv.missing_logs, 0) AS missing_logs
          FROM aggregated ag
          FULL JOIN invalid iv ON iv.user_id = ag.user_id`;
}

async function loadAttendanceMetrics(monthStart, monthEnd, userId = null) {
  const includeUserFilter = userId != null;
  const params = [monthStart, monthEnd, BUSINESS_START_HOUR, LUNCH_START_HOUR, LUNCH_END_HOUR, BUSINESS_END_HOUR];
  if (includeUserFilter) {
    params.push(userId);
  }

  const result = await pool.query(buildAttendanceMetricsQuery(includeUserFilter), params);
  return new Map(
    result.rows.map((row) => [Number(row.user_id), {
      nonHolidayWorkedHours: Number(row.non_holiday_worked_hours || 0),
      nonHolidayOvertimeHours: Number(row.non_holiday_overtime_hours || 0),
      holidayWorkedHours: Number(row.holiday_worked_hours || 0),
      holidayOvertimeHours: Number(row.holiday_overtime_hours || 0),
      holidayWeightedWorkedHours: Number(row.holiday_weighted_worked_hours || 0),
      holidayWeightedOvertimeHours: Number(row.holiday_weighted_overtime_hours || 0),
      missingLogs: Number(row.missing_logs || 0)
    }])
  );
}

function applyHolidayPolicy(metrics, holidayMode) {
  if (holidayMode === "multiplier") {
    return {
      workedHours: Number((metrics.nonHolidayWorkedHours + metrics.holidayWeightedWorkedHours).toFixed(2)),
      overtimeHours: Number((metrics.nonHolidayOvertimeHours + metrics.holidayWeightedOvertimeHours).toFixed(2)),
      holidayHoursExcluded: 0
    };
  }

  return {
    workedHours: Number(metrics.nonHolidayWorkedHours.toFixed(2)),
    overtimeHours: Number(metrics.nonHolidayOvertimeHours.toFixed(2)),
    holidayHoursExcluded: Number((metrics.holidayWorkedHours + metrics.holidayOvertimeHours).toFixed(2))
  };
}

app.get("/health", (req, res) => {
  res.json({ service: "user-service", status: "ok" });
});

app.get("/users", authenticate, authorize("HR_MANAGER", "PROJECT_MANAGER"), async (req, res) => {
  try {
    const whereClause = req.user.role === "HR_MANAGER" ? "WHERE COALESCE(a.role, 'EMPLOYEE') NOT IN ('SUPER_ADMIN', 'ADMIN')" : "";
    const { rows } = await pool.query(
      `SELECT u.id,
              u.employee_code,
              u.first_name,
              u.last_name,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.last_name, u.first_name)), ''), u.full_name) AS full_name,
              u.phone,
              u.email,
              a.role,
              a.account_status,
              COALESCE(u.status, 'WORKING') AS status,
              u.gender,
              u.birth_date,
              u.address,
              u.profile_image_url,
              u.created_at,
              u.updated_at
       FROM users u
       LEFT JOIN accounts a ON a.user_id = u.id
       ${whereClause}
       ORDER BY u.id DESC`
    );

    await writeDataLog({
      action: "read",
      collection: "user",
      recordId: "list",
      username: req.user.email,
      metadata: { count: rows.length }
    });

    res.json(rows);
  } catch (error) {
    res.status(500).json({ message: "Failed to load người dùngs", error: error.message });
  }
});

app.get("/users/face-status", authenticate, authorize("HR_MANAGER"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id,
              u.employee_code,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.last_name, u.first_name)), ''), u.full_name) AS full_name,
              u.email,
              COALESCE(u.status, 'WORKING') AS status,
              CASE WHEN u.face_template IS NULL OR TRIM(u.face_template) = '' THEN FALSE ELSE TRUE END AS has_face_template
       FROM users u
       LEFT JOIN accounts a ON a.user_id = u.id
       WHERE COALESCE(a.role, 'EMPLOYEE') NOT IN ('SUPER_ADMIN', 'ADMIN')
       ORDER BY u.id DESC`
    );

    await writeDataLog({
      action: "read",
      collection: "user-face-status",
      recordId: "list",
      username: req.user.email,
      metadata: { count: rows.length }
    });

    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch face status", error: error.message });
  }
});

app.get("/users/holidays", authenticate, authorize("HR_MANAGER"), async (req, res) => {
  try {
    const from = req.query.from ? normalizeDateOnly(req.query.from) : null;
    const to = req.query.to ? normalizeDateOnly(req.query.to) : null;
    const keyword = String(req.query.keyword || "").trim().toLowerCase();
    const isActiveRaw = req.query.isActive;

    if (req.query.from && !from) {
      return res.status(400).json({ message: "from must be in YYYY-MM-DD format" });
    }
    if (req.query.to && !to) {
      return res.status(400).json({ message: "to must be in YYYY-MM-DD format" });
    }
    if (from && to && from > to) {
      return res.status(400).json({ message: "from must be <= to" });
    }

    const clauses = [];
    const params = [];
    if (from) {
      params.push(from);
      clauses.push(`holiday_date >= $${params.length}::date`);
    }
    if (to) {
      params.push(to);
      clauses.push(`holiday_date <= $${params.length}::date`);
    }
    if (keyword) {
      params.push(`%${keyword}%`);
      clauses.push(`LOWER(holiday_name) LIKE $${params.length}`);
    }
    if (isActiveRaw != null) {
      const normalizedFlag = String(isActiveRaw).trim().toLowerCase();
      if (!["true", "false"].includes(normalizedFlag)) {
        return res.status(400).json({ message: "isActive must be true or false" });
      }
      params.push(normalizedFlag === "true");
      clauses.push(`is_active = $${params.length}`);
    }

    const whereClause = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const { rows } = await pool.query(
      `SELECT id, holiday_date, holiday_name, multiplier, is_active, created_at, updated_at
       FROM holidays
       ${whereClause}
       ORDER BY holiday_date ASC`,
      params
    );

    await writeDataLog({
      action: "read",
      collection: "holidays",
      recordId: "list",
      username: req.user.email,
      metadata: { count: rows.length, from, to, keyword, isActive: isActiveRaw ?? null }
    });

    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load holidays", error: error.message });
  }
});

app.post("/users/holidays", authenticate, authorize("HR_MANAGER"), async (req, res) => {
  try {
    const holidayDate = normalizeDateOnly(req.body.holidayDate);
    const holidayName = String(req.body.holidayName || "").trim();
    const multiplier = req.body.multiplier == null ? 1 : toNumber(req.body.multiplier);
    const isActive = req.body.isActive == null ? true : Boolean(req.body.isActive);

    if (!holidayDate) {
      return res.status(400).json({ message: "holidayDate must be in YYYY-MM-DD format" });
    }
    if (!holidayName) {
      return res.status(400).json({ message: "holidayName is required" });
    }
    if (multiplier == null || multiplier <= 0) {
      return res.status(400).json({ message: "multiplier must be a positive number" });
    }

    const result = await pool.query(
      `INSERT INTO holidays (holiday_date, holiday_name, multiplier, is_active)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (holiday_date)
       DO UPDATE SET
         holiday_name = EXCLUDED.holiday_name,
         multiplier = EXCLUDED.multiplier,
         is_active = EXCLUDED.is_active,
         updated_at = NOW()
       RETURNING id, holiday_date, holiday_name, multiplier, is_active, created_at, updated_at`,
      [holidayDate, holidayName, multiplier, isActive]
    );

    await writeDataLog({
      action: "create",
      collection: "holidays",
      recordId: String(result.rows[0].id),
      username: req.user.email,
      metadata: { holidayDate, holidayName, multiplier, isActive }
    });

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to create holiday", error: error.message });
  }
});

app.put("/users/holidays/:id", authenticate, authorize("HR_MANAGER"), async (req, res) => {
  try {
    const holidayId = Number(req.params.id);
    if (!Number.isInteger(holidayId) || holidayId <= 0) {
      return res.status(400).json({ message: "Holiday id is invalid" });
    }

    const updates = [];
    const params = [];

    if (req.body.holidayDate !== undefined) {
      const holidayDate = normalizeDateOnly(req.body.holidayDate);
      if (!holidayDate) {
        return res.status(400).json({ message: "holidayDate must be in YYYY-MM-DD format" });
      }
      params.push(holidayDate);
      updates.push(`holiday_date = $${params.length}`);
    }

    if (req.body.holidayName !== undefined) {
      const holidayName = String(req.body.holidayName || "").trim();
      if (!holidayName) {
        return res.status(400).json({ message: "holidayName must not be empty" });
      }
      params.push(holidayName);
      updates.push(`holiday_name = $${params.length}`);
    }

    if (req.body.multiplier !== undefined) {
      const multiplier = toNumber(req.body.multiplier);
      if (multiplier == null || multiplier <= 0) {
        return res.status(400).json({ message: "multiplier must be a positive number" });
      }
      params.push(multiplier);
      updates.push(`multiplier = $${params.length}`);
    }

    if (req.body.isActive !== undefined) {
      params.push(Boolean(req.body.isActive));
      updates.push(`is_active = $${params.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({ message: "No update fields provided" });
    }

    params.push(holidayId);
    const result = await pool.query(
      `UPDATE holidays
       SET ${updates.join(", ")},
           updated_at = NOW()
       WHERE id = $${params.length}
       RETURNING id, holiday_date, holiday_name, multiplier, is_active, created_at, updated_at`,
      params
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Holiday not found" });
    }

    await writeDataLog({
      action: "update",
      collection: "holidays",
      recordId: String(holidayId),
      username: req.user.email,
      metadata: req.body
    });

    return res.json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to update holiday", error: error.message });
  }
});

app.delete("/users/holidays/:id", authenticate, authorize("HR_MANAGER"), async (req, res) => {
  try {
    const holidayId = Number(req.params.id);
    if (!Number.isInteger(holidayId) || holidayId <= 0) {
      return res.status(400).json({ message: "Holiday id is invalid" });
    }

    const result = await pool.query(
      `DELETE FROM holidays
       WHERE id = $1
       RETURNING id, holiday_date, holiday_name`,
      [holidayId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Holiday not found" });
    }

    await writeDataLog({
      action: "delete",
      collection: "holidays",
      recordId: String(holidayId),
      username: req.user.email,
      metadata: result.rows[0]
    });

    return res.json({ message: "Holiday deleted successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete holiday", error: error.message });
  }
});

app.get("/users/:id", authenticate, async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (req.user.role === "EMPLOYEE" && req.user.sub !== userId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const result = await pool.query(
      `SELECT u.id,
              u.employee_code,
              u.first_name,
              u.last_name,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.last_name, u.first_name)), ''), u.full_name) AS full_name,
              u.phone,
              u.email,
              a.role,
              a.account_status,
              COALESCE(u.status, 'WORKING') AS status,
              u.gender,
              u.birth_date,
              u.address,
              u.profile_image_url,
              u.face_template,
              u.created_at,
              u.updated_at
       FROM users u
       LEFT JOIN accounts a ON a.user_id = u.id
       WHERE u.id = $1`,
      [userId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    await writeDataLog({
      action: "read",
      collection: "user",
      recordId: String(userId),
      username: req.user.email
    });

    return res.json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load người dùng", error: error.message });
  }
});

app.post("/users", authenticate, authorize("HR_MANAGER"), async (req, res) => {
  const client = await pool.connect();
  try {
    const {
      firstName,
      lastName,
      fullName,
      phone,
      email,
      gender,
      birthDate,
      address,
      profileImageUrl,
      faceTemplate,
      employmentStatus
    } = req.body;

    const normalizedNames = normalizeNameInput(firstName, lastName, fullName);
    if (!normalizedNames.firstName || !normalizedNames.lastName || !email) {
      return res.status(400).json({ message: "Thiếu trường bắt buộc: firstName, lastName, email" });
    }

    const normalizedBirthDate = normalizeBirthDate(birthDate);
    if (Number.isNaN(normalizedBirthDate)) {
      return res.status(400).json({ message: "birthDate is invalid" });
    }

    const passwordHash = await bcrypt.hash(DEFAULT_NEW_USER_PASSWORD, 10);
    const normalizedFullName = `${normalizedNames.lastName} ${normalizedNames.firstName}`.trim();
    const normalizedEmploymentStatus = EMPLOYMENT_STATUSES.includes(String(employmentStatus || "").toUpperCase())
      ? String(employmentStatus).toUpperCase()
      : "WORKING";

    await client.query("BEGIN");
    const insertedUser = await client.query(
      `INSERT INTO users (
        first_name, last_name, full_name, phone, email, gender, birth_date, address, profile_image_url, face_template, status
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
      RETURNING id, employee_code, first_name, last_name, full_name, phone, email, gender, birth_date, address, profile_image_url, status, created_at`,
      [
        normalizedNames.firstName,
        normalizedNames.lastName,
        normalizedFullName,
        phone || null,
        email,
        gender || null,
        normalizedBirthDate,
        address || null,
        profileImageUrl || null,
        faceTemplate || null,
        normalizedEmploymentStatus
      ]
    );

    await client.query(
      `INSERT INTO accounts (user_id, role, password_hash, account_status, password_changed_at)
       VALUES ($1, 'EMPLOYEE', $2, 'ACTIVE', NOW())
       ON CONFLICT (user_id) DO NOTHING`,
      [insertedUser.rows[0].id, passwordHash]
    );

    await client.query("COMMIT");

    await writeDataLog({
      action: "create",
      collection: "user",
      recordId: String(insertedUser.rows[0].id),
      username: req.user.email,
      metadata: {
        email: insertedUser.rows[0].email,
        role: "EMPLOYEE",
        employeeCode: insertedUser.rows[0].employee_code,
        defaultPassword: true
      }
    });

    return res.status(201).json({
      ...insertedUser.rows[0],
      role: "EMPLOYEE",
      accountCreated: true,
      defaultPassword: DEFAULT_NEW_USER_PASSWORD
    });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error.code === "23505") {
      return res.status(409).json({ message: "Email already exists" });
    }
    return res.status(500).json({ message: "Failed to create người dùng", error: error.message });
  } finally {
    client.release();
  }
});

app.put("/users/:id", authenticate, authorize("HR_MANAGER", "PROJECT_MANAGER", "EMPLOYEE"), async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (req.user.role === "EMPLOYEE" && req.user.sub !== userId) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const { firstName, lastName, fullName, phone, email, gender, birthDate, address, profileImageUrl, faceTemplate, employmentStatus } = req.body;

    const normalizedNames = normalizeNameInput(firstName, lastName, fullName);
    const nextFirstName = normalizedNames.firstName || undefined;
    const nextLastName = normalizedNames.lastName || undefined;

    const normalizedBirthDate = normalizeBirthDate(birthDate);
    if (Number.isNaN(normalizedBirthDate)) {
      return res.status(400).json({ message: "birthDate is invalid" });
    }
    const normalizedEmploymentStatus =
      employmentStatus === undefined
        ? undefined
        : EMPLOYMENT_STATUSES.includes(String(employmentStatus || "").toUpperCase())
          ? String(employmentStatus).toUpperCase()
          : null;
    if (employmentStatus !== undefined && normalizedEmploymentStatus === null) {
      return res.status(400).json({ message: "employmentStatus must be WORKING or RESIGNED" });
    }

    const result = await pool.query(
      `UPDATE users
       SET first_name = COALESCE($1, first_name),
           last_name = COALESCE($2, last_name),
           full_name = TRIM(CONCAT_WS(' ', COALESCE($2::text, last_name), COALESCE($1::text, first_name))),
           phone = COALESCE($3, phone),
           email = COALESCE($4, email),
           gender = COALESCE($5, gender),
           birth_date = COALESCE($6, birth_date),
           address = COALESCE($7, address),
           profile_image_url = COALESCE($8, profile_image_url),
           face_template = COALESCE($9, face_template),
           status = COALESCE($10, status),
           updated_at = NOW()
       WHERE id = $11
       RETURNING id, employee_code, first_name, last_name, full_name, phone, email, gender, birth_date, address, profile_image_url, status, updated_at`,
      [nextFirstName, nextLastName, phone, email, gender, normalizedBirthDate, address, profileImageUrl, faceTemplate, normalizedEmploymentStatus, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    await writeDataLog({
      action: "update",
      collection: "user",
      recordId: String(userId),
      username: req.user.email,
      metadata: {
        changedFields: ["firstName", "lastName", "phone", "email", "gender", "birthDate", "address", "profileImageUrl", "faceTemplate"].filter(
          (field) => req.body[field] !== undefined
        )
      }
    });

    return res.json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ message: "Email already exists" });
    }
    return res.status(500).json({ message: "Failed to update người dùng", error: error.message });
  }
});

app.delete("/users/:id", authenticate, authorize("HR_MANAGER"), async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (req.user.sub === userId) {
      return res.status(403).json({ message: "You cannot delete your own account" });
    }
    const result = await pool.query(
      `UPDATE users u
       SET status = 'RESIGNED', updated_at = NOW()
       WHERE u.id = $1
       RETURNING u.id, u.email`,
      [userId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }
    await pool.query(
      `UPDATE accounts
       SET account_status = 'INACTIVE',
           failed_login_attempts = 0,
           locked_until = NULL,
           updated_at = NOW()
       WHERE user_id = $1`,
      [userId]
    );

    await writeDataLog({
      action: "update",
      collection: "user",
      recordId: String(userId),
      username: req.user.email,
      metadata: { email: result.rows[0]?.email || null, status: "RESIGNED" }
    });

    return res.json({ message: "User status updated to RESIGNED" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update user status", error: error.message });
  }
});

app.put("/users/:id/face-template", authenticate, authorize("HR_MANAGER", "PROJECT_MANAGER", "EMPLOYEE"), async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (req.user.role === "EMPLOYEE" && req.user.sub !== userId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const { faceTemplate } = req.body;
    const normalizedTemplate = normalizeFaceTemplatePayload(faceTemplate);
    if (normalizedTemplate.error) {
      return res.status(400).json({ message: normalizedTemplate.error });
    }

    const result = await pool.query(
      "UPDATE users SET face_template = $1, updated_at = NOW() WHERE id = $2 RETURNING id, COALESCE(NULLIF(TRIM(CONCAT_WS(' ', last_name, first_name)), ''), full_name) AS full_name, face_template",
      [normalizedTemplate.value, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    await writeDataLog({
      action: "update",
      collection: "user-face-template",
      recordId: String(userId),
      username: req.user.email,
      metadata: normalizedTemplate.metadata
    });

    return res.json({ message: "Face template saved to database", user: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update face template", error: error.message });
  }
});

app.delete("/users/:id/face-template", authenticate, authorize("HR_MANAGER"), async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const result = await pool.query(
      `UPDATE users
       SET face_template = NULL,
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, email`,
      [userId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    await writeDataLog({
      action: "delete",
      collection: "user-face-template",
      recordId: String(userId),
      username: req.user.email
    });

    return res.json({ message: "Face template reset successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to reset face template", error: error.message });
  }
});

app.post("/salary/calculate", authenticate, authorize("HR_MANAGER"), async (req, res) => {
  try {
    const now = new Date();
    const month = toNumber(req.body.month) || now.getMonth() + 1;
    const year = toNumber(req.body.year) || now.getFullYear();
    const standardHours = toNumber(req.body.standardHours) ?? DEFAULT_MONTHLY_STANDARD_HOURS;
    const globalHourlyRate = toNumber(req.body.hourlyRate);
    const overtimeMultiplier = toNumber(req.body.overtimeMultiplier) ?? DEFAULT_OVERTIME_MULTIPLIER;
    const userId = req.body.userId == null ? null : toNumber(req.body.userId);
    const dryRun = Boolean(req.body.dryRun);
    const holidayMode = normalizeHolidayMode(req.body.holidayMode);

    if (month < 1 || month > 12 || year < 2000 || year > 2100) {
      return res.status(400).json({ message: "month/year are invalid" });
    }
    if (standardHours <= 0 || overtimeMultiplier <= 0) {
      return res.status(400).json({ message: "standardHours/overtimeMultiplier must be positive" });
    }
    if (globalHourlyRate != null && globalHourlyRate <= 0) {
      return res.status(400).json({ message: "hourlyRate must be positive" });
    }
    if (req.body.userId != null && (userId == null || userId <= 0)) {
      return res.status(400).json({ message: "userId is invalid" });
    }

    const monthStart = `${year}-${String(month).padStart(2, "0")}-01T00:00:00.000Z`;
    const monthEnd = new Date(Date.UTC(year, month, 1)).toISOString();
    const attendanceMetrics = await loadAttendanceMetrics(monthStart, monthEnd, userId);

    const employeeParams = [];
    let employeeWhere = "";
    if (userId != null) {
      employeeParams.push(userId);
      employeeWhere = ` AND u.id = $${employeeParams.length + 1}`;
    }

    const employeeResult = await pool.query(
      `SELECT u.id, COALESCE(u.hourly_rate, $1::numeric) AS hourly_rate
       FROM users u
       JOIN accounts a ON a.user_id = u.id
       WHERE a.role = 'EMPLOYEE'
         AND COALESCE(u.status, 'WORKING') = 'WORKING'
         ${employeeWhere}
       ORDER BY u.id`,
      [DEFAULT_HOURLY_RATE, ...employeeParams]
    );

    if (employeeResult.rowCount === 0) {
      return res.json({
        message: "No employee found for salary calculation",
        month,
        year,
        records: [],
        persisted: false
      });
    }

    const records = [];

    for (const row of employeeResult.rows) {
      const employeeId = Number(row.id);
      const metrics = attendanceMetrics.get(employeeId) || {
        nonHolidayWorkedHours: 0,
        nonHolidayOvertimeHours: 0,
        holidayWorkedHours: 0,
        holidayOvertimeHours: 0,
        holidayWeightedWorkedHours: 0,
        holidayWeightedOvertimeHours: 0,
        missingLogs: 0
      };
      const { workedHours, overtimeHours, holidayHoursExcluded } = applyHolidayPolicy(metrics, holidayMode);
      const hourlyRate = globalHourlyRate ?? Number(row.hourly_rate || DEFAULT_HOURLY_RATE);
      const overtimeRate = roundMoney(hourlyRate * overtimeMultiplier);
      const paidBaseHours = workedHours;
      const baseSalary = roundMoney(paidBaseHours * hourlyRate);
      const bonus = 0;
      const deductions = 0;
      const totalSalary = roundMoney(baseSalary + overtimeHours * overtimeRate + bonus - deductions);

      records.push({
        userId: employeeId,
        month,
        year,
        workedHours,
        standardHours,
        paidBaseHours,
        overtimeHours,
        hourlyRate,
        overtimeRate,
        baseSalary,
        bonus,
        deductions,
        totalSalary,
        missingAttendanceLogs: metrics.missingLogs,
        holidayMode,
        holidayHoursExcluded
      });
    }

    if (!dryRun) {
      for (const item of records) {
        await pool.query(
          `INSERT INTO salaries (
             user_id, month, year, base_salary, overtime_hours, overtime_rate, bonus, deductions, total_salary, payment_date, status, notes
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NULL, 'PENDING', $10)
           ON CONFLICT (user_id, month, year)
           DO UPDATE SET
             base_salary = EXCLUDED.base_salary,
             overtime_hours = EXCLUDED.overtime_hours,
             overtime_rate = EXCLUDED.overtime_rate,
             bonus = EXCLUDED.bonus,
             deductions = EXCLUDED.deductions,
             total_salary = EXCLUDED.total_salary,
             notes = EXCLUDED.notes,
             status = 'PENDING',
             updated_at = NOW()`,
          [
            item.userId,
            item.month,
            item.year,
            item.baseSalary,
            item.overtimeHours,
            item.overtimeRate,
            item.bonus,
            item.deductions,
            item.totalSalary,
            `AUTO_CALCULATED_FROM_ATTENDANCE: workedHours=${item.workedHours}, overtimeHours=${item.overtimeHours}, holidayMode=${holidayMode}, missingLogs=${item.missingAttendanceLogs}, hourlyRate=${item.hourlyRate}`
          ]
        );
      }
    }

    await writeDataLog({
      action: dryRun ? "preview" : "calculate",
      collection: "salary",
      recordId: `${month}-${year}`,
      username: req.user.email,
      metadata: {
        month,
        year,
        userId,
        recordCount: records.length,
        standardHours,
        hourlyRate: globalHourlyRate,
        overtimeMultiplier,
        holidayMode,
        dryRun
      }
    });

    return res.json({
      message: dryRun ? "Salary preview calculated successfully" : "Salary calculated successfully",
      month,
      year,
      persisted: !dryRun,
      records
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to calculate salary", error: error.message });
  }
});

app.get("/salary/manage", authenticate, authorize("HR_MANAGER"), async (req, res) => {
  try {
    const now = new Date();
    const month = toNumber(req.query.month) || now.getMonth() + 1;
    const year = toNumber(req.query.year) || now.getFullYear();
    const keyword = String(req.query.keyword || "").trim().toLowerCase();
    const holidayMode = normalizeHolidayMode(req.query.holidayMode);

    if (month < 1 || month > 12 || year < 2000 || year > 2100) {
      return res.status(400).json({ message: "month/year are invalid" });
    }

    const monthStart = `${year}-${String(month).padStart(2, "0")}-01T00:00:00.000Z`;
    const monthEnd = new Date(Date.UTC(year, month, 1)).toISOString();
    const metricsByUser = await loadAttendanceMetrics(monthStart, monthEnd, null);
    const params = [month, year, DEFAULT_HOURLY_RATE];
    let keywordClause = "";
    if (keyword) {
      params.push(`%${keyword}%`);
      keywordClause = `
        AND (
          LOWER(COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.last_name, u.first_name)), ''), u.full_name)) LIKE $${params.length}
          OR LOWER(COALESCE(u.employee_code, '')) LIKE $${params.length}
          OR LOWER(COALESCE(u.email, '')) LIKE $${params.length}
        )`;
    }

    const result = await pool.query(
      `SELECT
         u.id AS user_id,
         u.employee_code,
         COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.last_name, u.first_name)), ''), u.full_name) AS full_name,
         u.email,
         COALESCE(u.hourly_rate, $3::numeric) AS hourly_rate,
         s.id AS salary_id,
         s.base_salary,
         s.overtime_hours,
         s.overtime_rate,
         s.bonus,
         s.deductions,
         s.total_salary,
         s.status,
         s.payment_date,
         s.notes
       FROM users u
       JOIN accounts a ON a.user_id = u.id
       LEFT JOIN salaries s ON s.user_id = u.id AND s.month = $1 AND s.year = $2
       WHERE a.role = 'EMPLOYEE'
         AND COALESCE(u.status, 'WORKING') = 'WORKING'
         ${keywordClause}
       ORDER BY full_name ASC`,
      params
    );

    const records = result.rows.map((row) => {
      const metrics = metricsByUser.get(Number(row.user_id)) || {
        nonHolidayWorkedHours: 0,
        nonHolidayOvertimeHours: 0,
        holidayWorkedHours: 0,
        holidayOvertimeHours: 0,
        holidayWeightedWorkedHours: 0,
        holidayWeightedOvertimeHours: 0,
        missingLogs: 0
      };
      const { workedHours, overtimeHours, holidayHoursExcluded } = applyHolidayPolicy(metrics, holidayMode);
      return {
        ...row,
        worked_hours: workedHours,
        overtime_hours_calculated: overtimeHours,
        missing_attendance_logs: metrics.missingLogs,
        holiday_mode: holidayMode,
        holiday_hours_excluded: holidayHoursExcluded
      };
    });

    await writeDataLog({
      action: "read",
      collection: "salary-management",
      recordId: `${month}-${year}`,
      username: req.user.email,
      metadata: { month, year, keyword, holidayMode, count: records.length }
    });

    return res.json({
      month,
      year,
      records
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch salary management data", error: error.message });
  }
});

app.get("/salary", authenticate, authorize("EMPLOYEE"), async (req, res) => {
  try {
    const { month, year } = req.query;
    const currentMonth = month ? Number(month) : new Date().getMonth() + 1;
    const currentYear = year ? Number(year) : new Date().getFullYear();

    const result = await pool.query(
      `SELECT s.*, COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.last_name, u.first_name)), ''), u.full_name) AS full_name, u.employee_code
       FROM salaries s
       JOIN users u ON s.user_id = u.id
       WHERE s.user_id = $1 AND s.month = $2 AND s.year = $3
       ORDER BY s.created_at DESC`,
      [req.user.sub, currentMonth, currentYear]
    );

    await writeDataLog({
      action: "read",
      collection: "salary",
      recordId: `${req.user.sub}-${currentMonth}-${currentYear}`,
      username: req.user.email,
      metadata: { month: currentMonth, year: currentYear, count: result.rows.length }
    });

    return res.json(result.rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load lương", error: error.message });
  }
});

app.get("/salary/history", async (req, res) => {
  try {
    const userResult = await pool.query("SELECT id FROM users WHERE email = $1", ["worker@mdp.local"]);
    const userId = userResult.rows[0]?.id;

    const result = await pool.query(
      `SELECT s.*, COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.last_name, u.first_name)), ''), u.full_name) AS full_name, u.employee_code
       FROM salaries s
       JOIN users u ON s.user_id = u.id
       WHERE s.user_id = $1
       ORDER BY s.year DESC, s.month DESC`,
      [userId]
    );

    await writeDataLog({
      action: "read",
      collection: "salary-history",
      recordId: String(userId),
      username: "worker@mdp.local",
      metadata: { count: result.rows.length }
    });

    return res.json(result.rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load lịch sử lương", error: error.message });
  }
});

// ✅ FIX: Add /users/salary/manage alias for frontend compatibility
app.get("/users/salary/manage", authenticate, authorize("HR_MANAGER"), async (req, res) => {
  // Alias to existing /salary/manage endpoint - same logic, same query params
  const query = req.url.includes("?") ? req.url.split("?")[1] : "";
  req.url = "/salary/manage" + (query ? `?${query}` : "");
  return app._router.handle(req, res);
});

app.post("/users/salary/calculate", authenticate, authorize("HR_MANAGER"), async (req, res) => {
  req.url = "/salary/calculate";
  return app._router.handle(req, res);
});

app.get("/users/salary", authenticate, authorize("EMPLOYEE"), async (req, res) => {
  const query = req.url.includes("?") ? req.url.split("?")[1] : "";
  req.url = "/salary" + (query ? `?${query}` : "");
  return app._router.handle(req, res);
});

app.get("/users/salary/history", async (req, res) => {
  const query = req.url.includes("?") ? req.url.split("?")[1] : "";
  req.url = "/salary/history" + (query ? `?${query}` : "");
  return app._router.handle(req, res);
});

async function ensureSalarySchema() {
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(14,2) NOT NULL DEFAULT ${DEFAULT_HOURLY_RATE}`);

  await pool.query(
    `CREATE TABLE IF NOT EXISTS holidays (
      id SERIAL PRIMARY KEY,
      holiday_date DATE NOT NULL UNIQUE,
      holiday_name VARCHAR(255) NOT NULL,
      multiplier NUMERIC(6,2) NOT NULL DEFAULT 1,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`
  );

  await pool.query("CREATE INDEX IF NOT EXISTS idx_holidays_active_date ON holidays (holiday_date) WHERE is_active = TRUE");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_attendance_logs_user_project_time ON attendance_logs (user_id, project_id, check_in_time, check_out_time)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_project_assignments_user_project_window ON project_assignments (user_id, project_id, work_start, work_end)");
}

async function start() {
  await ensureSalarySchema();
  app.listen(port, () => {
    console.log(`user-service listening on ${port}`);
  });
}

start().catch((error) => {
  console.error("user-service startup failed:", error.message);
  process.exit(1);
});

