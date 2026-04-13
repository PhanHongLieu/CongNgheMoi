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
    const hourlyRate = toNumber(req.body.hourlyRate) ?? DEFAULT_HOURLY_RATE;
    const overtimeMultiplier = toNumber(req.body.overtimeMultiplier) ?? DEFAULT_OVERTIME_MULTIPLIER;
    const userId = req.body.userId == null ? null : toNumber(req.body.userId);
    const dryRun = Boolean(req.body.dryRun);

    if (month < 1 || month > 12 || year < 2000 || year > 2100) {
      return res.status(400).json({ message: "month/year are invalid" });
    }
    if (standardHours <= 0 || hourlyRate <= 0 || overtimeMultiplier <= 0) {
      return res.status(400).json({ message: "standardHours/hourlyRate/overtimeMultiplier must be positive" });
    }
    if (req.body.userId != null && (userId == null || userId <= 0)) {
      return res.status(400).json({ message: "userId is invalid" });
    }

    const monthStart = `${year}-${String(month).padStart(2, "0")}-01T00:00:00.000Z`;
    const monthEnd = new Date(Date.UTC(year, month, 1)).toISOString();

    const values = [monthStart, monthEnd];
    let userFilter = "";
    if (userId != null) {
      values.push(userId);
      userFilter = `AND a.user_id = $${values.length}`;
    }

    const attendanceAgg = await pool.query(
      `WITH overlapped AS (
        SELECT
          a.user_id,
          GREATEST(
            a.check_in_time,
            COALESCE(pa.work_start, a.check_in_time),
            $1::timestamp
          ) AS start_at,
          LEAST(
            COALESCE(a.check_out_time, a.check_in_time),
            COALESCE(pa.work_end, COALESCE(a.check_out_time, a.check_in_time)),
            $2::timestamp
          ) AS end_at
        FROM attendance_logs a
        JOIN project_assignments pa
          ON pa.user_id = a.user_id
         AND pa.project_id = a.project_id
        WHERE a.check_in_time < $2::timestamp
          AND COALESCE(a.check_out_time, a.check_in_time) > $1::timestamp
          ${userFilter}
      )
      SELECT
        user_id,
        ROUND(SUM(EXTRACT(EPOCH FROM (end_at - start_at)) / 3600.0)::numeric, 2) AS worked_hours
      FROM overlapped
      WHERE end_at > start_at
      GROUP BY user_id`,
      values
    );

    if (attendanceAgg.rowCount === 0) {
      return res.json({
        message: "No attendance data found for salary calculation",
        month,
        year,
        records: [],
        persisted: false
      });
    }

    const overtimeRate = Number((hourlyRate * overtimeMultiplier).toFixed(2));
    const records = [];

    for (const row of attendanceAgg.rows) {
      const workedHours = Number(row.worked_hours || 0);
      const paidBaseHours = Math.min(workedHours, standardHours);
      const overtimeHours = Math.max(0, workedHours - standardHours);
      const baseSalary = Number((paidBaseHours * hourlyRate).toFixed(2));
      const bonus = 0;
      const deductions = 0;
      const totalSalary = Number((baseSalary + overtimeHours * overtimeRate + bonus - deductions).toFixed(2));

      records.push({
        userId: row.user_id,
        month,
        year,
        workedHours,
        standardHours,
        paidBaseHours,
        overtimeHours: Number(overtimeHours.toFixed(2)),
        hourlyRate,
        overtimeRate,
        baseSalary,
        bonus,
        deductions,
        totalSalary
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
            `AUTO_CALCULATED_FROM_ATTENDANCE: workedHours=${item.workedHours}, standardHours=${item.standardHours}, hourlyRate=${item.hourlyRate}`
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
        hourlyRate,
        overtimeMultiplier,
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

    if (month < 1 || month > 12 || year < 2000 || year > 2100) {
      return res.status(400).json({ message: "month/year are invalid" });
    }

    const monthStart = `${year}-${String(month).padStart(2, "0")}-01T00:00:00.000Z`;
    const monthEnd = new Date(Date.UTC(year, month, 1)).toISOString();
    const params = [monthStart, monthEnd, month, year];
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
      `WITH worked AS (
         SELECT
           a.user_id,
           ROUND(SUM(EXTRACT(EPOCH FROM (
             LEAST(
               COALESCE(a.check_out_time, a.check_in_time),
               COALESCE(pa.work_end, COALESCE(a.check_out_time, a.check_in_time)),
               $2::timestamp
             ) - GREATEST(
               a.check_in_time,
               COALESCE(pa.work_start, a.check_in_time),
               $1::timestamp
             )
           )) / 3600.0)::numeric, 2) AS worked_hours
         FROM attendance_logs a
         JOIN project_assignments pa
           ON pa.user_id = a.user_id
          AND pa.project_id = a.project_id
         WHERE a.check_in_time < $2::timestamp
           AND COALESCE(a.check_out_time, a.check_in_time) > $1::timestamp
         GROUP BY a.user_id
       )
       SELECT
         u.id AS user_id,
         u.employee_code,
         COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.last_name, u.first_name)), ''), u.full_name) AS full_name,
         u.email,
         COALESCE(w.worked_hours, 0) AS worked_hours,
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
       LEFT JOIN worked w ON w.user_id = u.id
       LEFT JOIN salaries s ON s.user_id = u.id AND s.month = $3 AND s.year = $4
       WHERE a.role = 'EMPLOYEE'
         AND COALESCE(u.status, 'WORKING') = 'WORKING'
         ${keywordClause}
       ORDER BY full_name ASC`,
      params
    );

    await writeDataLog({
      action: "read",
      collection: "salary-management",
      recordId: `${month}-${year}`,
      username: req.user.email,
      metadata: { month, year, keyword, count: result.rows.length }
    });

    return res.json({
      month,
      year,
      records: result.rows
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
  req.url = "/salary/manage" + (req.url.includes("?") ? req.url.split("?")[1] : "");
  return app._router.handle(req, res);
});

app.listen(port, () => {
  console.log(`user-service listening on ${port}`);
});

