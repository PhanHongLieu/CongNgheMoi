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

async function generateEmployeeCode() {
  const result = await pool.query(
    `SELECT MAX(CAST(SUBSTRING(employee_code FROM POSITION('-' IN employee_code) + 1) AS INTEGER)) as max_num
     FROM users
     WHERE employee_code ~ '^[A-Z]+-[0-9]+$'`
  );

  const maxNum = result.rows[0]?.max_num || 0;
  const newNum = Number(maxNum) + 1;
  return `USR-${String(newNum).padStart(3, "0")}`;
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

app.get("/health", (req, res) => {
  res.json({ service: "user-service", status: "ok" });
});

app.get("/users", authenticate, authorize("ADMIN", "MANAGER"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT u.id,
              u.employee_code,
              u.first_name,
              u.last_name,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.last_name, u.first_name)), ''), u.full_name) AS full_name,
              u.phone,
              u.email,
              a.role,
              u.gender,
              u.birth_date,
              u.address,
              u.created_at,
              u.updated_at
       FROM users u
       LEFT JOIN accounts a ON a.user_id = u.id
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
    res.status(500).json({ message: "Failed to fetch users", error: error.message });
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
              u.gender,
              u.birth_date,
              u.address,
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
    return res.status(500).json({ message: "Failed to fetch user", error: error.message });
  }
});

app.post("/users", authenticate, authorize("ADMIN"), async (req, res) => {
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
      faceTemplate
    } = req.body;

    const normalizedNames = normalizeNameInput(firstName, lastName, fullName);
    if (!normalizedNames.firstName || !normalizedNames.lastName || !email) {
      return res.status(400).json({ message: "Missing required fields: firstName, lastName, email" });
    }

    const normalizedBirthDate = normalizeBirthDate(birthDate);
    if (Number.isNaN(normalizedBirthDate)) {
      return res.status(400).json({ message: "birthDate is invalid" });
    }

    const employeeCode = await generateEmployeeCode();
    const passwordHash = await bcrypt.hash(DEFAULT_NEW_USER_PASSWORD, 10);
    const normalizedFullName = `${normalizedNames.lastName} ${normalizedNames.firstName}`.trim();

    await client.query("BEGIN");
    const insertedUser = await client.query(
      `INSERT INTO users (
        employee_code, first_name, last_name, full_name, phone, email, gender, birth_date, address, face_template
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING id, employee_code, first_name, last_name, full_name, phone, email, gender, birth_date, address, created_at`,
      [
        employeeCode,
        normalizedNames.firstName,
        normalizedNames.lastName,
        normalizedFullName,
        phone || null,
        email,
        gender || null,
        normalizedBirthDate,
        address || null,
        faceTemplate || null
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
    return res.status(500).json({ message: "Failed to create user", error: error.message });
  } finally {
    client.release();
  }
});

app.put("/users/:id", authenticate, authorize("ADMIN", "MANAGER", "EMPLOYEE"), async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (req.user.role === "EMPLOYEE" && req.user.sub !== userId) {
      return res.status(403).json({ message: "Forbidden" });
    }
    const { firstName, lastName, fullName, phone, email, gender, birthDate, address, faceTemplate } = req.body;

    const normalizedNames = normalizeNameInput(firstName, lastName, fullName);
    const nextFirstName = normalizedNames.firstName || undefined;
    const nextLastName = normalizedNames.lastName || undefined;

    const normalizedBirthDate = normalizeBirthDate(birthDate);
    if (Number.isNaN(normalizedBirthDate)) {
      return res.status(400).json({ message: "birthDate is invalid" });
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
           face_template = COALESCE($8, face_template),
           updated_at = NOW()
       WHERE id = $9
       RETURNING id, employee_code, first_name, last_name, full_name, phone, email, gender, birth_date, address, updated_at`,
      [nextFirstName, nextLastName, phone, email, gender, normalizedBirthDate, address, faceTemplate, userId]
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
        changedFields: ["firstName", "lastName", "phone", "email", "gender", "birthDate", "address", "faceTemplate"].filter(
          (field) => req.body[field] !== undefined
        )
      }
    });

    return res.json(result.rows[0]);
  } catch (error) {
    if (error.code === "23505") {
      return res.status(409).json({ message: "Email already exists" });
    }
    return res.status(500).json({ message: "Failed to update user", error: error.message });
  }
});

app.delete("/users/:id", authenticate, authorize("ADMIN"), async (req, res) => {
  const client = await pool.connect();
  try {
    const userId = Number(req.params.id);
    const target = await client.query("SELECT email FROM users WHERE id = $1", [userId]);
    if (target.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    await client.query("BEGIN");
    await client.query("DELETE FROM accounts WHERE user_id = $1", [userId]);
    const result = await client.query("DELETE FROM users WHERE id = $1", [userId]);
    if (result.rowCount === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ message: "User not found" });
    }
    await client.query("COMMIT");

    await writeDataLog({
      action: "delete",
      collection: "user",
      recordId: String(userId),
      username: req.user.email,
      metadata: { deletedEmail: target.rows[0]?.email || null, deletedAccount: true }
    });

    return res.json({ message: "User deleted" });
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore rollback errors
    }
    return res.status(500).json({ message: "Failed to delete user", error: error.message });
  } finally {
    client.release();
  }
});

app.put("/users/:id/face-template", authenticate, authorize("ADMIN", "MANAGER", "EMPLOYEE"), async (req, res) => {
  try {
    const userId = Number(req.params.id);
    if (req.user.role === "EMPLOYEE" && req.user.sub !== userId) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const { faceTemplate } = req.body;
    if (!faceTemplate) {
      return res.status(400).json({ message: "faceTemplate is required" });
    }

    const result = await pool.query(
      "UPDATE users SET face_template = $1, updated_at = NOW() WHERE id = $2 RETURNING id, COALESCE(NULLIF(TRIM(CONCAT_WS(' ', last_name, first_name)), ''), full_name) AS full_name, face_template",
      [faceTemplate, userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    await writeDataLog({
      action: "update",
      collection: "user-face-template",
      recordId: String(userId),
      username: req.user.email
    });

    return res.json({ message: "Face template updated", user: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update face template", error: error.message });
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
    return res.status(500).json({ message: "Failed to fetch salary", error: error.message });
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
    return res.status(500).json({ message: "Failed to fetch salary history", error: error.message });
  }
});

app.listen(port, () => {
  console.log(`user-service listening on ${port}`);
});
