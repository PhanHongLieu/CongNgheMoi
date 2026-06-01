require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");
const Minio = require("minio");

const app = express();
const port = Number(process.env.PORT || process.env.USER_SERVICE_PORT || 3002);

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
const DEFAULT_NEW_USER_PASSWORD = "123456";
const EMPLOYMENT_STATUSES = ["WORKING", "RESIGNED"];
const DEFAULT_MONTHLY_STANDARD_HOURS = Number(process.env.SALARY_STANDARD_HOURS || 208);
const DEFAULT_STANDARD_WORKING_DAYS = Number(process.env.SALARY_STANDARD_WORKING_DAYS || 26);
const DEFAULT_HOURLY_RATE = Number(process.env.SALARY_HOURLY_RATE || 35000);
const DEFAULT_OVERTIME_MULTIPLIER = Number(process.env.SALARY_OVERTIME_MULTIPLIER || 1.5);
const BUSINESS_START_HOUR = Number(process.env.SALARY_BUSINESS_START_HOUR || 8);
const LUNCH_START_HOUR = Number(process.env.SALARY_LUNCH_START_HOUR || 12);
const LUNCH_END_HOUR = Number(process.env.SALARY_LUNCH_END_HOUR || 13);
const BUSINESS_END_HOUR = Number(process.env.SALARY_BUSINESS_END_HOUR || 17);
const HOLIDAY_MODES = ["exclude", "multiplier"];
const DEFAULT_HOLIDAY_MODE = String(process.env.SALARY_HOLIDAY_MODE || "exclude").trim().toLowerCase();
const MINIO_ENDPOINT = process.env.MINIO_ENDPOINT || "minio";
const MINIO_PORT = Number(process.env.MINIO_PORT || 9000);
const MINIO_USE_SSL = String(process.env.MINIO_USE_SSL || "false").toLowerCase() === "true";
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || process.env.MINIO_ROOT_USER || "mdp_minio";
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || process.env.MINIO_ROOT_PASSWORD || "mdp_minio_password";
const MINIO_BUCKET = process.env.MINIO_BUCKET || "face-enrollments";
const MINIO_PUBLIC_BASE_URL = process.env.MINIO_PUBLIC_BASE_URL || "http://localhost:9000";
const MINIO_ENABLED = String(process.env.MINIO_ENABLED || "true").toLowerCase() !== "false";

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "10mb" }));

const minioClient = new Minio.Client({
  endPoint: MINIO_ENDPOINT,
  port: MINIO_PORT,
  useSSL: MINIO_USE_SSL,
  accessKey: MINIO_ACCESS_KEY,
  secretKey: MINIO_SECRET_KEY
});

async function ensureFaceEnrollmentSchema() {
  await pool.query(`
    DO $$
    BEGIN
      IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'users'
          AND column_name = 'face_template'
          AND data_type <> 'jsonb'
      ) THEN
        EXECUTE 'ALTER TABLE users ALTER COLUMN face_template TYPE JSONB USING CASE WHEN face_template IS NULL OR TRIM(face_template) = '''' THEN NULL ELSE face_template::jsonb END';
      END IF;
    END $$;
  `);
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS face_enrollment_status VARCHAR(20) NOT NULL DEFAULT 'UNREGISTERED'");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS face_enrollment_submitted_at TIMESTAMP");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS face_enrollment_reviewed_at TIMESTAMP");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS face_enrollment_reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS face_enrollment_note TEXT");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title VARCHAR(120)");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS skill_level VARCHAR(30)");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS trade_code VARCHAR(30)");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS specialization VARCHAR(120)");
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS job_title_id INTEGER");
  await pool.query(`
    CREATE TABLE IF NOT EXISTS job_titles (
      id SERIAL PRIMARY KEY,
      code VARCHAR(40) UNIQUE NOT NULL,
      name VARCHAR(120) NOT NULL,
      category VARCHAR(80),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `);
  await pool.query("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_job_title_id_fkey");
  await pool.query("ALTER TABLE users ADD CONSTRAINT users_job_title_id_fkey FOREIGN KEY (job_title_id) REFERENCES job_titles(id) ON DELETE SET NULL");
  await pool.query("ALTER TABLE users DROP CONSTRAINT IF EXISTS users_face_enrollment_status_check");
  await pool.query(
    "ALTER TABLE users ADD CONSTRAINT users_face_enrollment_status_check CHECK (face_enrollment_status IN ('UNREGISTERED', 'PENDING', 'APPROVED', 'REJECTED'))"
  );
  await pool.query(`
    UPDATE users
    SET face_enrollment_status = CASE
      WHEN face_template IS NULL THEN 'UNREGISTERED'
      ELSE 'APPROVED'
    END
    WHERE face_enrollment_status IS NULL
       OR face_enrollment_status NOT IN ('UNREGISTERED', 'PENDING', 'APPROVED', 'REJECTED')
  `);
  if (MINIO_ENABLED) {
    const exists = await minioClient.bucketExists(MINIO_BUCKET).catch(() => false);
    if (!exists) {
      await minioClient.makeBucket(MINIO_BUCKET, "us-east-1");
    }
  }
}

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

const DEFAULT_SYSTEM_SETTINGS = {
  gpsMaxRadius: 100,
  faceMatchThreshold: 90,
  maxLoginAttempts: 5,
  lockoutDuration: 30,
  sessionTimeout: 60
};

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function normalizeSystemSettings(input = {}) {
  return {
    gpsMaxRadius: clampNumber(input.gpsMaxRadius, 10, 500, DEFAULT_SYSTEM_SETTINGS.gpsMaxRadius),
    faceMatchThreshold: clampNumber(input.faceMatchThreshold, 50, 100, DEFAULT_SYSTEM_SETTINGS.faceMatchThreshold),
    maxLoginAttempts: clampNumber(input.maxLoginAttempts, 3, 10, DEFAULT_SYSTEM_SETTINGS.maxLoginAttempts),
    lockoutDuration: clampNumber(input.lockoutDuration, 5, 120, DEFAULT_SYSTEM_SETTINGS.lockoutDuration),
    sessionTimeout: clampNumber(input.sessionTimeout, 15, 480, DEFAULT_SYSTEM_SETTINGS.sessionTimeout)
  };
}

async function ensureSystemSettingsSchema() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS system_settings (
      setting_key VARCHAR(120) PRIMARY KEY,
      setting_value JSONB NOT NULL,
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`
  );
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
  const raw = typeof input === "string" ? input.trim() : "";
  const parsedInput = typeof input === "object" && input !== null ? input : null;
  if (!raw && !parsedInput) {
    return { error: "faceTemplate is required" };
  }

  try {
    const parsed = parsedInput || JSON.parse(raw);
    const primaryTemplate = String(parsed?.primaryTemplate || "").trim();
    const primaryEmbedding = normalizeEmbeddingVector(parsed?.primaryEmbedding);
    if (!primaryTemplate && primaryEmbedding.length === 0) {
      return { error: "faceTemplate requires primaryTemplate or primaryEmbedding" };
    }

    const sampleUrlsInput = parsed && typeof parsed.sampleUrls === "object" && parsed.sampleUrls !== null ? parsed.sampleUrls : {};
    const sampleUrls = {};
    for (const [key, value] of Object.entries(sampleUrlsInput)) {
      const url = String(value || "").trim();
      if (/^https?:\/\//i.test(url)) {
        sampleUrls[key] = url;
      }
    }
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
      sampleUrls,
      signatures,
      embeddings: normalizedEmbeddings,
      livenessProfile: parsed?.livenessProfile && typeof parsed.livenessProfile === "object" ? parsed.livenessProfile : null
    };

    return {
      value: normalized,
      metadata: {
        mode: "json",
        sampleUrlCount: Object.keys(sampleUrls).length,
        version: normalized.version,
        embeddingDim: normalized.embeddingDim,
        hasEmbedding: primaryEmbedding.length > 0
      }
    };
  } catch {
    return { error: "faceTemplate must be valid JSON" };
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

async function resolveStandardWorkingDays(month, year, fallback = null) {
  const fallbackValue = Number.isFinite(Number(fallback)) && Number(fallback) > 0 ? Number(fallback) : DEFAULT_STANDARD_WORKING_DAYS;
  try {
    const { rows } = await pool.query(
      `SELECT standard_working_days
       FROM salary_month_settings
       WHERE month = $1 AND year = $2
       LIMIT 1`,
      [month, year]
    );
    const fromDb = Number(rows[0]?.standard_working_days || 0);
    if (Number.isFinite(fromDb) && fromDb > 0) {
      return fromDb;
    }
    return fallbackValue;
  } catch {
    return fallbackValue;
  }
}

function parseDataUrl(input) {
  const value = String(input || "").trim();
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/.exec(value);
  if (!match) {
    return null;
  }
  const mimeType = match[1].toLowerCase();
  const base64 = match[2];
  const extMap = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp"
  };
  const extension = extMap[mimeType];
  if (!extension) {
    return null;
  }
  const buffer = Buffer.from(base64, "base64");
  if (!buffer.length) {
    return null;
  }
  return { buffer, mimeType, extension };
}

function buildAttendanceMetricsQuery(includeUserFilter) {
  const userFilterClause = includeUserFilter ? "AND t.user_id = $3" : "";
  return `WITH classified AS (
            SELECT
              t.user_id,
              t.work_date,
              GREATEST(COALESCE(t.actual_hours, 0) - COALESCE(t.ot_hours, 0), 0) AS worked_hours,
              COALESCE(t.ot_hours, 0) AS overtime_hours,
              h.multiplier AS holiday_multiplier
            FROM timesheets t
            LEFT JOIN holidays h
              ON h.holiday_date = t.work_date
             AND h.is_active = TRUE
            WHERE t.work_date >= $1::date
              AND t.work_date < $2::date
              AND t.timesheet_status IN ('READY', 'LOCKED', 'APPROVED')
              ${userFilterClause}
          ),
          aggregated AS (
            SELECT
              user_id,
              COUNT(DISTINCT work_date)::numeric AS worked_days,
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
              t.user_id,
              COUNT(*)::int AS missing_logs
            FROM timesheets t
            WHERE t.work_date >= $1::date
              AND t.work_date < $2::date
              AND t.timesheet_status IN ('MISSING_OUT', 'PENDING', 'INVALID')
              ${userFilterClause}
            GROUP BY t.user_id
          )
          SELECT
            COALESCE(ag.user_id, iv.user_id) AS user_id,
            COALESCE(ag.non_holiday_worked_hours, 0) AS non_holiday_worked_hours,
            COALESCE(ag.worked_days, 0) AS worked_days,
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
  const params = [monthStart, monthEnd];
  if (includeUserFilter) {
    params.push(userId);
  }

  const result = await pool.query(buildAttendanceMetricsQuery(includeUserFilter), params);
  return new Map(
    result.rows.map((row) => [Number(row.user_id), {
      nonHolidayWorkedHours: Number(row.non_holiday_worked_hours || 0),
      workedDays: Number(row.worked_days || 0),
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

app.get("/audit/logs", authenticate, authorize("SUPER_ADMIN", "ADMIN"), async (req, res) => {
  try {
    const action = String(req.query.action || "").trim();
    const user = String(req.query.user || "").trim();
    const from = String(req.query.from || "").trim();
    const to = String(req.query.to || "").trim();
    const limit = Math.min(Math.max(Number(req.query.limit || 200), 1), 500);
    const values = [];
    const filters = [];

    if (action) {
      values.push(action);
      filters.push(`UPPER(dl.action) = UPPER($${values.length})`);
    }
    if (user) {
      values.push(`%${user}%`);
      filters.push(`(
        dl.username ILIKE $${values.length}
        OR u.full_name ILIKE $${values.length}
        OR u.employee_code ILIKE $${values.length}
      )`);
    }
    if (from) {
      values.push(from);
      filters.push(`dl.created_at >= $${values.length}::date`);
    }
    if (to) {
      values.push(to);
      filters.push(`dl.created_at < ($${values.length}::date + INTERVAL '1 day')`);
    }

    values.push(limit);
    const { rows } = await pool.query(
      `SELECT
         dl.id,
         dl.service_name,
         UPPER(dl.action) AS action,
         dl.collection,
         dl.record_id,
         dl.username,
         dl.metadata,
         dl.created_at,
         COALESCE(u.full_name, dl.username, 'System') AS user_name,
         COALESCE(u.employee_code, '') AS employee_code,
         CONCAT_WS(' ',
           dl.service_name || ':',
           UPPER(dl.action),
           dl.collection,
           CASE WHEN dl.record_id IS NOT NULL THEN '#' || dl.record_id ELSE NULL END
         ) AS details,
         NULL::text AS ip_address
       FROM data_logs dl
       LEFT JOIN users u ON LOWER(u.email) = LOWER(dl.username)
       ${filters.length ? `WHERE ${filters.join(" AND ")}` : ""}
       ORDER BY dl.created_at DESC, dl.id DESC
       LIMIT $${values.length}`,
      values
    );
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load audit log", error: error.message });
  }
});

app.get("/system/settings", authenticate, authorize("SUPER_ADMIN", "ADMIN"), async (req, res) => {
  try {
    await ensureSystemSettingsSchema();
    const { rows } = await pool.query(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'global'"
    );
    const saved = rows[0]?.setting_value || {};
    return res.json(normalizeSystemSettings({ ...DEFAULT_SYSTEM_SETTINGS, ...saved }));
  } catch (error) {
    return res.status(500).json({ message: "Failed to load system settings", error: error.message });
  }
});

app.put("/system/settings", authenticate, authorize("SUPER_ADMIN", "ADMIN"), async (req, res) => {
  try {
    await ensureSystemSettingsSchema();
    const settings = normalizeSystemSettings(req.body || {});
    const updatedBy = Number.isInteger(Number(req.user?.sub)) ? Number(req.user.sub) : null;
    const { rows } = await pool.query(
      `INSERT INTO system_settings (setting_key, setting_value, updated_by)
       VALUES ('global', $1::jsonb, $2)
       ON CONFLICT (setting_key)
       DO UPDATE SET
         setting_value = EXCLUDED.setting_value,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING setting_value`,
      [JSON.stringify(settings), updatedBy]
    );
    await writeDataLog({
      action: "update",
      collection: "system-settings",
      recordId: "global",
      username: req.user.email,
      metadata: settings
    });
    return res.json(rows[0].setting_value);
  } catch (error) {
    return res.status(500).json({ message: "Failed to save system settings", error: error.message });
  }
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
              u.job_title,
              u.skill_level,
              u.trade_code,
              u.specialization,
              u.base_monthly_salary,
              u.job_title_id,
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
              u.profile_image_url,
              u.face_template,
              COALESCE(u.status, 'WORKING') AS status,
              CASE WHEN u.face_template IS NULL THEN FALSE ELSE TRUE END AS has_face_template,
              COALESCE(u.face_enrollment_status, 'UNREGISTERED') AS face_enrollment_status,
              u.face_enrollment_submitted_at,
              u.face_enrollment_reviewed_at,
              u.face_enrollment_reviewed_by,
              u.face_enrollment_note
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
              u.job_title,
              u.skill_level,
              u.trade_code,
              u.specialization,
              u.base_monthly_salary,
              u.job_title_id,
              u.profile_image_url,
              u.face_template,
              COALESCE(u.face_enrollment_status, 'UNREGISTERED') AS face_enrollment_status,
              u.face_enrollment_submitted_at,
              u.face_enrollment_reviewed_at,
              u.face_enrollment_reviewed_by,
              u.face_enrollment_note,
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
      employmentStatus,
      jobTitle,
      skillLevel,
      tradeCode,
      specialization,
      baseMonthlySalary,
      jobTitleId
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
        first_name, last_name, full_name, phone, email, gender, birth_date, address, profile_image_url, face_template, status, job_title, skill_level, trade_code, specialization, job_title_id, base_monthly_salary
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
      RETURNING id, employee_code, first_name, last_name, full_name, phone, email, gender, birth_date, address, profile_image_url, status, job_title, skill_level, trade_code, specialization, base_monthly_salary, job_title_id, created_at`,
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
        normalizedEmploymentStatus,
        jobTitle || null,
        skillLevel || null,
        tradeCode || null,
        specialization || null,
        jobTitleId == null ? null : Number(jobTitleId),
        toNumber(baseMonthlySalary) ?? 0
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
    const { firstName, lastName, fullName, phone, email, gender, birthDate, address, profileImageUrl, faceTemplate, employmentStatus, jobTitle, skillLevel, tradeCode, specialization, jobTitleId, baseMonthlySalary } = req.body;

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
           job_title = COALESCE($11, job_title),
           skill_level = COALESCE($12, skill_level),
           trade_code = COALESCE($13, trade_code),
           specialization = COALESCE($14, specialization),
           job_title_id = COALESCE($15, job_title_id),
           base_monthly_salary = COALESCE($16, base_monthly_salary),
           updated_at = NOW()
       WHERE id = $17
       RETURNING id, employee_code, first_name, last_name, full_name, phone, email, gender, birth_date, address, profile_image_url, status, job_title, skill_level, trade_code, specialization, base_monthly_salary, job_title_id, updated_at`,
      [nextFirstName, nextLastName, phone, email, gender, normalizedBirthDate, address, profileImageUrl, faceTemplate, normalizedEmploymentStatus, jobTitle, skillLevel, tradeCode, specialization, jobTitleId == null ? null : Number(jobTitleId), toNumber(baseMonthlySalary), userId]
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
        changedFields: ["firstName", "lastName", "phone", "email", "gender", "birthDate", "address", "profileImageUrl", "faceTemplate", "jobTitle", "skillLevel", "tradeCode", "specialization", "jobTitleId"].filter(
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

    const submittedStatus = req.user.role === "HR_MANAGER" ? "APPROVED" : "PENDING";
    const result = await pool.query(
      `UPDATE users
       SET face_template = $1,
           face_enrollment_status = $2::text,
           face_enrollment_submitted_at = NOW(),
           face_enrollment_reviewed_at = CASE WHEN $2::text = 'APPROVED' THEN NOW() ELSE NULL END,
           face_enrollment_reviewed_by = CASE WHEN $2::text = 'APPROVED' THEN $3::int ELSE NULL END,
           face_enrollment_note = CASE WHEN $2::text = 'APPROVED' THEN 'Approved on submit by HR' ELSE 'Waiting for HR approval' END,
           updated_at = NOW()
       WHERE id = $4
       RETURNING id,
                 COALESCE(NULLIF(TRIM(CONCAT_WS(' ', last_name, first_name)), ''), full_name) AS full_name,
                 face_template,
                 face_enrollment_status`,
      [normalizedTemplate.value, submittedStatus, req.user.sub, userId]
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

    if (submittedStatus === "PENDING") {
      await notifyRoles("HR_MANAGER", {
        senderUserId: req.user.sub,
        title: "Face enrollment pending review",
        message: `${result.rows[0].full_name} submitted face enrollment and is waiting for HR approval.`,
        notificationType: "FACE_ENROLLMENT",
        priority: "NORMAL",
        actionUrl: "/users/face-status"
      });
    } else if (req.user.sub !== userId) {
      await createNotification({
        userId,
        senderUserId: req.user.sub,
        title: "Face enrollment approved",
        message: "Your face enrollment was approved and saved by HR.",
        notificationType: "FACE_ENROLLMENT",
        priority: "NORMAL",
        actionUrl: "/profile"
      });
    }

    return res.json({
      message: submittedStatus === "APPROVED" ? "Face template approved and saved" : "Face template submitted. Waiting for HR approval",
      user: result.rows[0]
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update face template", error: error.message });
  }
});

app.post("/users/:id/face-enrollment/samples-upload", authenticate, authorize("HR_MANAGER", "PROJECT_MANAGER", "EMPLOYEE"), async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (req.user.role === "EMPLOYEE" && req.user.sub !== userId) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const samples = req.body?.samples;
    if (!samples || typeof samples !== "object") {
      return res.status(400).json({ message: "samples object is required" });
    }

    const parsedEntries = Object.entries(samples)
      .map(([step, dataUrl]) => ({ step, dataUrl, parsed: parseDataUrl(dataUrl) }))
      .filter((item) => Boolean(item.parsed));

    if (!MINIO_ENABLED) {
      const sampleUrls = Object.fromEntries(parsedEntries.map((item) => [item.step, item.dataUrl]));
      if (Object.keys(sampleUrls).length === 0) {
        return res.status(400).json({ message: "No valid image samples to upload" });
      }
      await writeDataLog({
        action: "create",
        collection: "face-enrollment-samples",
        recordId: String(userId),
        username: req.user.email,
        metadata: { uploadedSteps: Object.keys(sampleUrls), storage: "database" }
      });
      return res.json({ message: "Face samples stored in enrollment payload", sampleUrls });
    }

    const uploaded = await Promise.all(
      parsedEntries.map(async ({ step, parsed }, index) => {
        const objectName = `users/${userId}/${Date.now()}-${index}-${step}.${parsed.extension}`;
        await minioClient.putObject(MINIO_BUCKET, objectName, parsed.buffer, parsed.buffer.length, {
          "Content-Type": parsed.mimeType
        });
        return {
          step,
          url: `${MINIO_PUBLIC_BASE_URL.replace(/\/$/, "")}/${MINIO_BUCKET}/${objectName}`
        };
      })
    );

    const sampleUrls = Object.fromEntries(uploaded.map((item) => [item.step, item.url]));

    if (Object.keys(sampleUrls).length === 0) {
      return res.status(400).json({ message: "No valid image samples to upload" });
    }

    await writeDataLog({
      action: "create",
      collection: "face-enrollment-samples",
      recordId: String(userId),
      username: req.user.email,
      metadata: { uploadedSteps: Object.keys(sampleUrls) }
    });

    return res.json({ message: "Face samples uploaded", sampleUrls });
  } catch (error) {
    return res.status(500).json({ message: "Failed to upload face samples", error: error.message });
  }
});

app.put("/users/:id/face-enrollment/review", authenticate, authorize("HR_MANAGER"), async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const decision = String(req.body.decision || "").trim().toUpperCase();
    const note = String(req.body.note || "").trim() || null;
    if (!["APPROVED", "REJECTED"].includes(decision)) {
      return res.status(400).json({ message: "decision must be APPROVED or REJECTED" });
    }

    const result = await pool.query(
      `UPDATE users
       SET face_enrollment_status = $1,
           face_enrollment_reviewed_at = NOW(),
           face_enrollment_reviewed_by = $2,
           face_enrollment_note = $3,
           updated_at = NOW()
       WHERE id = $4
       RETURNING id, employee_code, COALESCE(NULLIF(TRIM(CONCAT_WS(' ', last_name, first_name)), ''), full_name) AS full_name, face_enrollment_status`,
      [decision, req.user.sub, note, userId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    await writeDataLog({
      action: "update",
      collection: "user-face-enrollment-review",
      recordId: String(userId),
      username: req.user.email,
      metadata: { decision, note }
    });

    await createNotification({
      userId,
      senderUserId: req.user.sub,
      title: `Face enrollment ${decision.toLowerCase()}`,
      message: `Your face enrollment was ${decision.toLowerCase()}${note ? `: ${note}` : "."}`,
      notificationType: "FACE_ENROLLMENT",
      priority: decision === "REJECTED" ? "HIGH" : "NORMAL",
      actionUrl: "/profile"
    });

    return res.json({ message: `Face enrollment ${decision.toLowerCase()} successfully`, user: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: "Failed to review face enrollment", error: error.message });
  }
});

app.delete("/users/:id/face-template", authenticate, authorize("HR_MANAGER"), async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const result = await pool.query(
      `UPDATE users
       SET face_template = NULL,
           face_enrollment_status = 'UNREGISTERED',
           face_enrollment_submitted_at = NULL,
           face_enrollment_reviewed_at = NOW(),
           face_enrollment_reviewed_by = $2,
           face_enrollment_note = 'Template reset by HR',
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, email`,
      [userId, req.user.sub]
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

    await createNotification({
      userId,
      senderUserId: req.user.sub,
      title: "Face enrollment reset",
      message: "Your face enrollment template was reset by HR. Please enroll again before using face attendance.",
      notificationType: "FACE_ENROLLMENT",
      priority: "HIGH",
      actionUrl: "/profile"
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
    const requestedStandardWorkingDays = toNumber(req.body.standardWorkingDays);
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
    const standardWorkingDays = await resolveStandardWorkingDays(month, year, requestedStandardWorkingDays);
    if (requestedStandardWorkingDays && requestedStandardWorkingDays > 0) {
      await pool.query(
        `INSERT INTO salary_month_settings (month, year, standard_working_days, updated_by)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (month, year)
         DO UPDATE SET standard_working_days = EXCLUDED.standard_working_days, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
        [month, year, requestedStandardWorkingDays, req.user.sub]
      );
    }
    const attendanceMetrics = await loadAttendanceMetrics(monthStart, monthEnd, userId);

    const employeeParams = [];
    let employeeWhere = "";
    if (userId != null) {
      employeeParams.push(userId);
      employeeWhere = ` AND u.id = $${employeeParams.length + 1}`;
    }

    const employeeResult = await pool.query(
      `SELECT u.id, COALESCE(u.hourly_rate, $1::numeric) AS hourly_rate, COALESCE(u.base_monthly_salary, 0) AS base_monthly_salary
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
      const baseMonthlySalary = Number(row.base_monthly_salary || 0);
      const fallbackHourlyRate = Number(row.hourly_rate || DEFAULT_HOURLY_RATE);
      const hourlyRate = globalHourlyRate ?? (baseMonthlySalary > 0 ? baseMonthlySalary / standardWorkingDays / 8 : fallbackHourlyRate);
      const dailyRate = baseMonthlySalary > 0 ? baseMonthlySalary / standardWorkingDays : hourlyRate * 8;
      const workedDays = Number(metrics.workedDays || 0);
      const cappedWorkedDays = Math.min(workedDays, standardWorkingDays);
      const overflowWorkedDays = Math.max(0, workedDays - standardWorkingDays);
      const overtimeRate = roundMoney((dailyRate / 8) * overtimeMultiplier);
      const paidBaseHours = workedHours;
      const adjustedOvertimeHours = Number((overtimeHours + overflowWorkedDays * 8).toFixed(2));
      const baseSalary = roundMoney(cappedWorkedDays * dailyRate);
      const bonus = 0;
      const deductions = 0;
      const totalSalary = roundMoney(baseSalary + adjustedOvertimeHours * overtimeRate + bonus - deductions);

      records.push({
        userId: employeeId,
        month,
        year,
        workedHours,
        workedDays: Number(workedDays.toFixed(2)),
        cappedWorkedDays: Number(cappedWorkedDays.toFixed(2)),
        overflowWorkedDays: Number(overflowWorkedDays.toFixed(2)),
        standardHours,
        standardWorkingDays,
        baseMonthlySalary,
        dailyRate: roundMoney(dailyRate),
        paidBaseHours,
        overtimeHours: adjustedOvertimeHours,
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
             bonus = COALESCE(salaries.bonus, 0),
             deductions = COALESCE(salaries.deductions, 0),
             total_salary = ROUND(
               EXCLUDED.base_salary
               + (EXCLUDED.overtime_hours * EXCLUDED.overtime_rate)
               + COALESCE(salaries.bonus, 0)
               - COALESCE(salaries.deductions, 0),
               2
             ),
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
            `AUTO_CALCULATED_FROM_TIMESHEETS: workedHours=${item.workedHours}, workedDays=${item.workedDays}, cappedWorkedDays=${item.cappedWorkedDays}, overflowWorkedDays=${item.overflowWorkedDays}, overtimeHours=${item.overtimeHours}, holidayMode=${holidayMode}, missingLogs=${item.missingAttendanceLogs}, hourlyRate=${item.hourlyRate}, baseMonthlySalary=${item.baseMonthlySalary}, standardWorkingDays=${item.standardWorkingDays}, dailyRate=${item.dailyRate}`
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
        standardWorkingDays,
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
    const standardWorkingDays = await resolveStandardWorkingDays(month, year, null);
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
         COALESCE(u.base_monthly_salary, 0) AS base_monthly_salary,
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
         s.notes,
         (
           SELECT COUNT(1)
           FROM attendance_logs al
           WHERE al.user_id = u.id
             AND DATE(al.check_in_time) >= make_date($2::int, $1::int, 1)
             AND DATE(al.check_in_time) < (make_date($2::int, $1::int, 1) + INTERVAL '1 month')
             AND al.attendance_status = 'LATE'
         ) AS late_count
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
        worked_days: Number(metrics.workedDays || 0),
        standard_working_days: standardWorkingDays,
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
      standardWorkingDays,
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
      `SELECT s.*, COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.last_name, u.first_name)), ''), u.full_name) AS full_name, u.employee_code,
              COALESCE(u.base_monthly_salary, 0) AS base_monthly_salary,
              COALESCE(cfg.standard_working_days, $4::numeric) AS standard_working_days
       FROM salaries s
       JOIN users u ON s.user_id = u.id
       LEFT JOIN salary_month_settings cfg ON cfg.month = s.month AND cfg.year = s.year
       WHERE s.user_id = $1 AND s.month = $2 AND s.year = $3
       ORDER BY s.created_at DESC`,
      [req.user.sub, currentMonth, currentYear, DEFAULT_STANDARD_WORKING_DAYS]
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

app.put("/users/salary/manage/:userId/adjustments", authenticate, authorize("HR_MANAGER"), async (req, res) => {
  try {
    const userId = Number(req.params.userId);
    const month = toNumber(req.body.month);
    const year = toNumber(req.body.year);
    if (!Number.isInteger(userId) || userId <= 0) {
      return res.status(400).json({ message: "userId is invalid" });
    }
    if (!month || month < 1 || month > 12 || !year || year < 2000 || year > 2100) {
      return res.status(400).json({ message: "month/year are invalid" });
    }

    const lunchAllowance = Math.max(0, toNumber(req.body.lunchAllowance) || 0);
    const transportAllowance = Math.max(0, toNumber(req.body.transportAllowance) || 0);
    const progressBonus = Math.max(0, toNumber(req.body.progressBonus) || 0);
    const safetyPenalty = Math.max(0, toNumber(req.body.safetyPenalty) || 0);
    const advanceDeduction = Math.max(0, toNumber(req.body.advanceDeduction) || 0);
    const autoLatePenalty = Math.max(0, toNumber(req.body.autoLatePenalty) || 0);

    const totalAllowances = lunchAllowance + transportAllowance + progressBonus;
    const totalDeductions = autoLatePenalty + safetyPenalty + advanceDeduction;

    const salaryResult = await pool.query(
      `SELECT id, base_salary, overtime_hours, overtime_rate, status
       FROM salaries
       WHERE user_id = $1 AND month = $2 AND year = $3
       LIMIT 1`,
      [userId, month, year]
    );
    if (salaryResult.rowCount === 0) {
      return res.status(404).json({ message: "Salary record not found for selected period" });
    }
    const row = salaryResult.rows[0];
    if (String(row.status || "").toUpperCase() === "LOCKED" || String(row.status || "").toUpperCase() === "PAID") {
      return res.status(409).json({ message: "Payroll already finalized/locked. Adjustments are disabled." });
    }
    const baseSalary = Number(row.base_salary || 0);
    const overtimePay = Number(row.overtime_hours || 0) * Number(row.overtime_rate || 0);
    const totalSalary = roundMoney(baseSalary + overtimePay + totalAllowances - totalDeductions);
    const breakdown = {
      lunchAllowance,
      transportAllowance,
      progressBonus,
      autoLatePenalty,
      safetyPenalty,
      advanceDeduction
    };

    await pool.query(
      `UPDATE salaries
       SET bonus = $1,
           deductions = $2,
           total_salary = $3,
           notes = CONCAT('ADJUSTMENT_BREAKDOWN:', $4::text),
           updated_at = NOW()
       WHERE id = $5`,
      [roundMoney(totalAllowances), roundMoney(totalDeductions), totalSalary, JSON.stringify(breakdown), row.id]
    );

    return res.json({
      userId,
      month,
      year,
      totalAllowances: roundMoney(totalAllowances),
      totalDeductions: roundMoney(totalDeductions),
      totalSalary
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update salary adjustments", error: error.message });
  }
});

app.post("/users/salary/finalize", authenticate, authorize("HR_MANAGER"), async (req, res) => {
  try {
    const month = toNumber(req.body.month);
    const year = toNumber(req.body.year);
    if (!month || month < 1 || month > 12 || !year || year < 2000 || year > 2100) {
      return res.status(400).json({ message: "month/year are invalid" });
    }
    await ensureSalarySchema();
    const existing = await pool.query(
      "SELECT COUNT(*)::int AS total FROM salaries WHERE month = $1 AND year = $2",
      [month, year]
    );
    if (Number(existing.rows[0]?.total || 0) === 0) {
      return res.status(404).json({ message: "No salary records found for selected period. Please calculate salary data before finalizing payroll." });
    }
    const result = await pool.query(
      `UPDATE salaries
       SET status = 'LOCKED',
           payment_date = COALESCE(payment_date, NOW()),
           updated_at = NOW()
       WHERE month = $1 AND year = $2`,
      [month, year]
    );
    return res.json({ message: "Payroll finalized", affectedRows: result.rowCount });
  } catch (error) {
    return res.status(500).json({ message: "Failed to finalize payroll", error: error.message });
  }
});

app.get("/users/salary/settings", authenticate, authorize("HR_MANAGER"), async (req, res) => {
  try {
    const now = new Date();
    const month = toNumber(req.query.month) || now.getMonth() + 1;
    const year = toNumber(req.query.year) || now.getFullYear();
    const standardWorkingDays = await resolveStandardWorkingDays(month, year, null);
    return res.json({ month, year, standardWorkingDays });
  } catch (error) {
    return res.status(500).json({ message: "Failed to load salary settings", error: error.message });
  }
});

app.put("/users/salary/settings", authenticate, authorize("HR_MANAGER"), async (req, res) => {
  try {
    const month = toNumber(req.body.month);
    const year = toNumber(req.body.year);
    const standardWorkingDays = toNumber(req.body.standardWorkingDays);
    if (!month || month < 1 || month > 12 || !year || year < 2000 || year > 2100) {
      return res.status(400).json({ message: "month/year are invalid" });
    }
    if (!standardWorkingDays || standardWorkingDays <= 0) {
      return res.status(400).json({ message: "standardWorkingDays must be positive" });
    }
    const { rows } = await pool.query(
      `INSERT INTO salary_month_settings (month, year, standard_working_days, updated_by)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (month, year)
       DO UPDATE SET standard_working_days = EXCLUDED.standard_working_days, updated_by = EXCLUDED.updated_by, updated_at = NOW()
       RETURNING month, year, standard_working_days`,
      [month, year, standardWorkingDays, req.user.sub]
    );
    return res.json({ month: rows[0].month, year: rows[0].year, standardWorkingDays: Number(rows[0].standard_working_days) });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update salary settings", error: error.message });
  }
});

async function ensureSalarySchema() {
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS hourly_rate NUMERIC(14,2) NOT NULL DEFAULT ${DEFAULT_HOURLY_RATE}`);
  await pool.query("ALTER TABLE users ADD COLUMN IF NOT EXISTS base_monthly_salary NUMERIC(14,2) NOT NULL DEFAULT 0");
  await pool.query(`UPDATE users SET base_monthly_salary = ROUND(COALESCE(base_monthly_salary, 0), 2)`);
  await pool.query(`UPDATE users SET base_monthly_salary = ROUND(COALESCE(hourly_rate, ${DEFAULT_HOURLY_RATE}) * ${DEFAULT_MONTHLY_STANDARD_HOURS}, 2) WHERE COALESCE(base_monthly_salary, 0) <= 0`);
  await pool.query("ALTER TABLE salaries ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'PENDING'");
  await pool.query("ALTER TABLE salaries ADD COLUMN IF NOT EXISTS payment_date DATE");
  await pool.query("ALTER TABLE salaries DROP CONSTRAINT IF EXISTS salaries_status_check");
  await pool.query("ALTER TABLE salaries ADD CONSTRAINT salaries_status_check CHECK (status IN ('PENDING', 'LOCKED', 'PAID', 'CANCELLED'))");
  await pool.query(
    `CREATE TABLE IF NOT EXISTS salary_month_settings (
      id SERIAL PRIMARY KEY,
      month INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
      year INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2100),
      standard_working_days NUMERIC(6,2) NOT NULL CHECK (standard_working_days > 0),
      updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW(),
      UNIQUE (month, year)
    )`
  );

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
  await pool.query(
    `CREATE TABLE IF NOT EXISTS timesheets (
      id SERIAL PRIMARY KEY,
      attendance_log_id INTEGER UNIQUE REFERENCES attendance_logs(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
      work_date DATE NOT NULL,
      check_in_time TIMESTAMP,
      check_out_time TIMESTAMP,
      raw_work_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
      break_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
      actual_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
      working_day_value NUMERIC(4,2) NOT NULL DEFAULT 0,
      ot_hours NUMERIC(8,2) NOT NULL DEFAULT 0,
      timesheet_status VARCHAR(20) NOT NULL DEFAULT 'PENDING',
      source VARCHAR(20) NOT NULL DEFAULT 'SYSTEM',
      locked_by_request_id INTEGER REFERENCES requests(id) ON DELETE SET NULL,
      notes TEXT,
      computed_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )`
  );

  await pool.query("CREATE INDEX IF NOT EXISTS idx_holidays_active_date ON holidays (holiday_date) WHERE is_active = TRUE");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_timesheets_user_work_date ON timesheets (user_id, work_date)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_timesheets_status ON timesheets (timesheet_status)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_attendance_logs_user_project_time ON attendance_logs (user_id, project_id, check_in_time, check_out_time)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_project_assignments_user_project_window ON project_assignments (user_id, project_id, work_start, work_end)");
}

async function start() {
  await ensureSystemSettingsSchema();
  await ensureSalarySchema();
app.listen(port, () => {
  console.log(`user-service listening on ${port}`);
});

ensureFaceEnrollmentSchema().catch((error) => {
  console.error("ensureFaceEnrollmentSchema failed:", error.message);
});
}

start().catch((error) => {
  console.error("user-service startup failed:", error.message);
  process.exit(1);
});

