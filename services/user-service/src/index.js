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

app.get("/health", (req, res) => {
  res.json({ service: "user-service", status: "ok" });
});

app.get("/users", authenticate, authorize("ADMIN", "MANAGER"), async (req, res) => {
  try {
    const { rows } = await pool.query(
      "SELECT id, employee_code, full_name, phone, email, role, position, department, created_at, updated_at FROM users ORDER BY id DESC"
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
      "SELECT id, employee_code, full_name, phone, email, role, position, department, face_template, created_at, updated_at FROM users WHERE id = $1",
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
  try {
    const {
      employeeCode,
      fullName,
      phone,
      email,
      password,
      role,
      position,
      department,
      faceTemplate
    } = req.body;

    if (!employeeCode || !fullName || !email || !password || !role) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (
        employee_code, full_name, phone, email, password_hash, role, position, department, face_template
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING id, employee_code, full_name, phone, email, role, position, department, created_at`,
      [employeeCode, fullName, phone || null, email, passwordHash, role, position || null, department || null, faceTemplate || null]
    );

    await writeDataLog({
      action: "create",
      collection: "user",
      recordId: String(result.rows[0].id),
      username: req.user.email,
      metadata: { email: result.rows[0].email, role: result.rows[0].role }
    });

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to create user", error: error.message });
  }
});

app.put("/users/:id", authenticate, authorize("ADMIN", "MANAGER"), async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const { fullName, phone, email, position, department, faceTemplate } = req.body;
    const result = await pool.query(
      `UPDATE users
       SET full_name = COALESCE($1, full_name),
           phone = COALESCE($2, phone),
           email = COALESCE($3, email),
           position = COALESCE($4, position),
           department = COALESCE($5, department),
           face_template = COALESCE($6, face_template),
           updated_at = NOW()
       WHERE id = $7
       RETURNING id, employee_code, full_name, phone, email, role, position, department, updated_at`,
      [fullName, phone, email, position, department, faceTemplate, userId]
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
        changedFields: ["fullName", "phone", "email", "position", "department", "faceTemplate"].filter(
          (field) => req.body[field] !== undefined
        )
      }
    });

    return res.json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to update user", error: error.message });
  }
});

app.delete("/users/:id", authenticate, authorize("ADMIN"), async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const target = await pool.query("SELECT email FROM users WHERE id = $1", [userId]);
    const result = await pool.query("DELETE FROM users WHERE id = $1", [userId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    await writeDataLog({
      action: "delete",
      collection: "user",
      recordId: String(userId),
      username: req.user.email,
      metadata: { deletedEmail: target.rows[0]?.email || null }
    });

    return res.json({ message: "User deleted" });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete user", error: error.message });
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
      "UPDATE users SET face_template = $1, updated_at = NOW() WHERE id = $2 RETURNING id, full_name, face_template",
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

app.listen(port, () => {
  console.log(`user-service listening on ${port}`);
});
