require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const app = express();
const port = Number(process.env.AUTH_SERVICE_PORT || 3001);

const pool = new Pool({
  host: process.env.POSTGRES_HOST || "localhost",
  port: Number(process.env.POSTGRES_PORT || 6543),
  database: process.env.POSTGRES_DB || "mdp_system",
  user: process.env.POSTGRES_USER || "mdp_user",
  password: process.env.POSTGRES_PASSWORD || "mdp_password"
});

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "5mb" }));

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "change_access_secret";
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || "change_refresh_secret";
const TOKEN_ISSUER = process.env.TOKEN_ISSUER || "mdp-system";

async function writeDataLog({ action, collection, recordId, username, metadata }) {
  try {
    await pool.query(
      `INSERT INTO data_logs (service_name, action, collection, record_id, username, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ["auth-service", action, collection, recordId || null, username || null, metadata || null]
    );
  } catch (error) {
    console.error("writeDataLog failed:", error.message);
  }
}

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, email: user.email, role: user.role, employeeCode: user.employee_code },
    ACCESS_SECRET,
    { expiresIn: "1h", issuer: TOKEN_ISSUER }
  );
}

function signRefreshToken(user) {
  return jwt.sign({ sub: user.id }, REFRESH_SECRET, { expiresIn: "7d", issuer: TOKEN_ISSUER });
}

function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const token = authHeader.split(" ")[1];
  try {
    const payload = jwt.verify(token, ACCESS_SECRET, { issuer: TOKEN_ISSUER });
    req.user = payload;
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
  res.json({ service: "auth-service", status: "ok" });
});

app.post("/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const { rows } = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    const user = rows[0];
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const matched = await bcrypt.compare(password, user.password_hash);
    if (!matched) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    const accessToken = signAccessToken(user);
    const refreshToken = signRefreshToken(user);

    await pool.query(
      "INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, NOW() + INTERVAL '7 days')",
      [user.id, refreshToken]
    );

    await writeDataLog({
      action: "login",
      collection: "auth",
      recordId: String(user.id),
      username: user.email
    });

    return res.json({
      accessToken,
      refreshToken,
      user: {
        id: user.id,
        employeeCode: user.employee_code,
        fullName: user.full_name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "Login failed", error: error.message });
  }
});

app.post("/auth/refresh", async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ message: "Refresh token is required" });
    }

    const payload = jwt.verify(refreshToken, REFRESH_SECRET, { issuer: TOKEN_ISSUER });
    const tokenCheck = await pool.query("SELECT * FROM refresh_tokens WHERE token = $1", [refreshToken]);
    if (tokenCheck.rowCount === 0) {
      return res.status(401).json({ message: "Refresh token revoked" });
    }

    const userQuery = await pool.query("SELECT * FROM users WHERE id = $1", [payload.sub]);
    if (userQuery.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const accessToken = signAccessToken(userQuery.rows[0]);

    await writeDataLog({
      action: "refresh",
      collection: "auth",
      recordId: String(payload.sub),
      username: userQuery.rows[0].email
    });

    return res.json({ accessToken });
  } catch (error) {
    return res.status(401).json({ message: "Invalid refresh token" });
  }
});

app.post("/auth/logout", async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ message: "Refresh token is required" });
    }

    const existing = await pool.query("SELECT user_id FROM refresh_tokens WHERE token = $1", [refreshToken]);
    await pool.query("DELETE FROM refresh_tokens WHERE token = $1", [refreshToken]);

    if (existing.rowCount > 0) {
      const userQuery = await pool.query("SELECT email FROM users WHERE id = $1", [existing.rows[0].user_id]);
      await writeDataLog({
        action: "logout",
        collection: "auth",
        recordId: String(existing.rows[0].user_id),
        username: userQuery.rows[0]?.email || null
      });
    }

    return res.json({ message: "Logged out" });
  } catch (error) {
    return res.status(500).json({ message: "Logout failed", error: error.message });
  }
});

app.put("/auth/users/:id/role", authenticate, authorize("ADMIN"), async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const { role } = req.body;

    if (!["ADMIN", "MANAGER", "EMPLOYEE"].includes(role)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    const result = await pool.query("UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2 RETURNING id, role", [role, userId]);
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    await writeDataLog({
      action: "update",
      collection: "user-role",
      recordId: String(userId),
      username: req.user.email,
      metadata: { role }
    });

    return res.json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Role update failed", error: error.message });
  }
});

app.listen(port, () => {
  console.log(`auth-service listening on ${port}`);
});
