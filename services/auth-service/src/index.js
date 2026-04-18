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
const MAX_FAILED_LOGINS = Number(process.env.MAX_FAILED_LOGINS || 5);
const LOCK_MINUTES = Number(process.env.LOGIN_LOCK_MINUTES || 30);
const EMPLOYEE_CODE_REGEX = /^[0-9]{8}$/;
const USER_ROLES = ["SUPER_ADMIN", "ADMIN", "HR_MANAGER", "PROJECT_MANAGER", "EMPLOYEE"];
const ACCOUNT_STATUSES = ["ACTIVE", "INACTIVE", "LOCKED"];
const RECAPTCHA_VERIFY_URL = "https://www.google.com/recaptcha/api/siteverify";
const RECAPTCHA_SECRET_KEY = String(process.env.RECAPTCHA_SECRET_KEY || "").trim();
const RECAPTCHA_MIN_SCORE = Number(process.env.RECAPTCHA_MIN_SCORE || 0.3);
const RECAPTCHA_EXPECTED_ACTION = String(process.env.RECAPTCHA_EXPECTED_ACTION || "login").trim();
const RECAPTCHA_MODE = String(process.env.RECAPTCHA_MODE || "v2_checkbox").trim().toLowerCase();

async function verifyGoogleRecaptcha(recaptchaToken, remoteIp, expectedAction) {
  const token = String(recaptchaToken || "").trim();
  if (!token) {
    return { ok: false, message: "Google reCAPTCHA is required" };
  }
  if (!RECAPTCHA_SECRET_KEY) {
    return { ok: false, message: "reCAPTCHA is not configured on server", status: 500 };
  }

  try {
    const form = new URLSearchParams();
    form.set("secret", RECAPTCHA_SECRET_KEY);
    form.set("response", token);
    if (remoteIp) {
      form.set("remoteip", String(remoteIp));
    }

    const response = await fetch(RECAPTCHA_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString()
    });

    if (!response.ok) {
      return { ok: false, message: "Unable to verify reCAPTCHA. Please try again." };
    }

    const data = await response.json();
    if (!data?.success) {
      return { ok: false, message: "Google reCAPTCHA verification failed" };
    }

    if (RECAPTCHA_MODE === "v3_score") {
      if (typeof data.score !== "number") {
        return { ok: false, message: "Google reCAPTCHA v3 score is missing" };
      }
      if (data.score < RECAPTCHA_MIN_SCORE) {
        return { ok: false, message: "Google reCAPTCHA score is too low" };
      }
      if (expectedAction) {
        const action = String(data.action || "").trim();
        if (!action || action !== expectedAction) {
          return { ok: false, message: "Google reCAPTCHA action is invalid" };
        }
      }
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, message: `reCAPTCHA verification error: ${error.message}` };
  }
}

function normalizeRole(role) {
  const value = String(role || "").trim().toUpperCase();
  if (value === "MANAGER") {
    return "PROJECT_MANAGER";
  }
  if (value === "SYSADMIN") {
    return "SUPER_ADMIN";
  }
  return value;
}

async function ensureAuthSchema() {
  await pool.query("ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_role_check");

  await pool.query(
    `UPDATE accounts
     SET role = CASE
       WHEN role = 'MANAGER' THEN 'PROJECT_MANAGER'
       WHEN role = 'SYSADMIN' THEN 'SUPER_ADMIN'
       ELSE role
     END
     WHERE role IN ('MANAGER', 'SYSADMIN')`
  );

  await pool.query(
    `ALTER TABLE accounts
     ADD CONSTRAINT accounts_role_check
     CHECK (role IN ('SUPER_ADMIN', 'ADMIN', 'HR_MANAGER', 'PROJECT_MANAGER', 'EMPLOYEE'))`
  );
}

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

async function getAccountByEmployeeCode(employeeCode) {
  const value = String(employeeCode || "").trim();
  const { rows } = await pool.query(
    `SELECT u.id,
            u.employee_code,
            u.first_name,
            u.last_name,
            COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.last_name, u.first_name)), ''), u.full_name) AS full_name,
            u.email,
            u.profile_image_url,
            CASE
              WHEN a.role = 'MANAGER' THEN 'PROJECT_MANAGER'
              WHEN a.role = 'SYSADMIN' THEN 'SUPER_ADMIN'
              ELSE a.role
            END AS role,
            a.password_hash,
            a.account_status,
            a.failed_login_attempts,
            a.locked_until
     FROM users u
     JOIN accounts a ON a.user_id = u.id
     WHERE UPPER(u.employee_code) = UPPER($1)
       `,
    [value]
  );
  return rows[0] || null;
}

async function getAccountByUserId(userId) {
  const { rows } = await pool.query(
    `SELECT u.id,
            u.employee_code,
            u.first_name,
            u.last_name,
            COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.last_name, u.first_name)), ''), u.full_name) AS full_name,
            u.email,
            u.profile_image_url,
            CASE
              WHEN a.role = 'MANAGER' THEN 'PROJECT_MANAGER'
              WHEN a.role = 'SYSADMIN' THEN 'SUPER_ADMIN'
              ELSE a.role
            END AS role,
            a.password_hash,
            a.account_status,
            a.failed_login_attempts,
            a.locked_until
     FROM users u
     JOIN accounts a ON a.user_id = u.id
     WHERE u.id = $1`,
    [userId]
  );
  return rows[0] || null;
}

async function getAccountRoleByUserId(userId) {
  const result = await pool.query("SELECT role FROM accounts WHERE user_id = $1", [userId]);
  if (result.rowCount === 0) {
    return null;
  }
  return normalizeRole(result.rows[0].role);
}

async function hasAnotherSuperAdmin(excludedUserId) {
  const result = await pool.query(
    "SELECT COUNT(*)::int AS total FROM accounts WHERE role = 'SUPER_ADMIN' AND user_id <> $1",
    [excludedUserId]
  );
  return Number(result.rows[0]?.total || 0) > 0;
}

app.get("/health", (req, res) => {
  res.json({ service: "auth-service", status: "ok" });
});

app.post("/auth/login", async (req, res) => {
  try {
    const employeeCode = String(req.body?.employeeCode || "").trim();
    const password = req.body?.password;
    const recaptchaToken = req.body?.recaptchaToken;
    if (!employeeCode || !password) {
      return res.status(400).json({ message: "Employee code and password are required" });
    }
    const captchaCheck = await verifyGoogleRecaptcha(recaptchaToken, req.ip, RECAPTCHA_EXPECTED_ACTION);
    if (!captchaCheck.ok) {
      return res.status(captchaCheck.status || 400).json({ message: captchaCheck.message });
    }
    if (!EMPLOYEE_CODE_REGEX.test(employeeCode)) {
      return res.status(400).json({ message: "Employee code must be exactly 8 digits" });
    }

    const user = await getAccountByEmployeeCode(employeeCode);
    if (!user) {
      return res.status(401).json({ message: "Invalid credentials" });
    }

    if (user.account_status === "INACTIVE") {
      return res.status(403).json({ message: "Account is inactive. Please contact administrator." });
    }

    if (user.account_status === "LOCKED") {
      const lockExpired = user.locked_until && new Date(user.locked_until) <= new Date();
      if (!lockExpired) {
        return res.status(403).json({
          message: "Account is locked. Please contact administrator or wait until lock expires.",
          lockedUntil: user.locked_until
        });
      }

      await pool.query(
        "UPDATE accounts SET account_status = 'ACTIVE', failed_login_attempts = 0, locked_until = NULL, updated_at = NOW() WHERE user_id = $1",
        [user.id]
      );
      user.account_status = "ACTIVE";
      user.failed_login_attempts = 0;
      user.locked_until = null;
    }

    const matched = await bcrypt.compare(password, user.password_hash);
    if (!matched) {
      const nextFailedAttempts = Number(user.failed_login_attempts || 0) + 1;
      if (nextFailedAttempts >= MAX_FAILED_LOGINS) {
        const lockedUntil = new Date(Date.now() + LOCK_MINUTES * 60 * 1000);
        await pool.query(
          "UPDATE accounts SET failed_login_attempts = $1, account_status = 'LOCKED', locked_until = $2, updated_at = NOW() WHERE user_id = $3",
          [nextFailedAttempts, lockedUntil, user.id]
        );
      } else {
        await pool.query("UPDATE accounts SET failed_login_attempts = $1, updated_at = NOW() WHERE user_id = $2", [nextFailedAttempts, user.id]);
      }
      return res.status(401).json({ message: "Invalid credentials" });
    }

    await pool.query(
      "UPDATE accounts SET failed_login_attempts = 0, locked_until = NULL, last_login_at = NOW(), updated_at = NOW() WHERE user_id = $1",
      [user.id]
    );

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
        role: user.role,
        profileImageUrl: user.profile_image_url || ""
      }
    });
  } catch (error) {
    return res.status(500).json({ message: "Đăng nhập failed", error: error.message });
  }
});

app.post("/auth/refresh", async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ message: "Refresh token là trường bắt buộc" });
    }

    const payload = jwt.verify(refreshToken, REFRESH_SECRET, { issuer: TOKEN_ISSUER });
    const tokenCheck = await pool.query("SELECT * FROM refresh_tokens WHERE token = $1", [refreshToken]);
    if (tokenCheck.rowCount === 0) {
      return res.status(401).json({ message: "Refresh token đã bị thu hồi" });
    }

    const user = await getAccountByUserId(payload.sub);
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }
    if (user.account_status !== "ACTIVE") {
      return res.status(403).json({ message: "Tài khoản chưa được kích hoạt" });
    }

    const accessToken = signAccessToken(user);

    await writeDataLog({
      action: "refresh",
      collection: "auth",
      recordId: String(payload.sub),
      username: user.email
    });

    return res.json({ accessToken });
  } catch (error) {
    return res.status(401).json({ message: "Refresh token is invalid" });
  }
});

app.post("/auth/logout", async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) {
      return res.status(400).json({ message: "Refresh token là trường bắt buộc" });
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
    return res.status(500).json({ message: "Đăng xuất failed", error: error.message });
  }
});

app.put("/auth/me/password", authenticate, async (req, res) => {
  try {
    const userId = Number(req.user.sub);
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ message: "currentPassword và newPassword is required" });
    }
    if (String(newPassword).length < 6) {
      return res.status(400).json({ message: "newPassword phải có ít nhất 6 ký tự" });
    }

    const account = await getAccountByUserId(userId);
    if (!account) {
      return res.status(404).json({ message: "Account not found" });
    }

    const matched = await bcrypt.compare(String(currentPassword), account.password_hash);
    if (!matched) {
      return res.status(400).json({ message: "Current password is incorrect" });
    }

    const passwordHash = await bcrypt.hash(String(newPassword), 10);
    await pool.query(
      `UPDATE accounts
       SET password_hash = $1,
           password_changed_at = NOW(),
           failed_login_attempts = 0,
           locked_until = NULL,
           account_status = CASE WHEN account_status = 'LOCKED' THEN 'ACTIVE' ELSE account_status END,
           updated_at = NOW()
       WHERE user_id = $2`,
      [passwordHash, userId]
    );

    await writeDataLog({
      action: "update",
      collection: "account-password-self",
      recordId: String(userId),
      username: req.user.email
    });

    return res.json({ message: "Password changed successfully" });
  } catch (error) {
    return res.status(500).json({ message: "Cập nhật mật khẩu failed", error: error.message });
  }
});

app.get("/auth/accounts", authenticate, authorize("SUPER_ADMIN", "ADMIN"), async (req, res) => {
  try {
    const isAdminRequester = req.user.role === "ADMIN";
    const { rows } = await pool.query(
      `SELECT u.id,
              u.employee_code,
              u.first_name,
              u.last_name,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.last_name, u.first_name)), ''), u.full_name) AS full_name,
              u.email,
              CASE
                WHEN a.role = 'MANAGER' THEN 'PROJECT_MANAGER'
                WHEN a.role = 'SYSADMIN' THEN 'SUPER_ADMIN'
                ELSE a.role
              END AS role,
              a.account_status,
              a.failed_login_attempts,
              a.locked_until,
              a.last_login_at,
              a.password_changed_at,
              a.created_at,
              a.updated_at
       FROM accounts a
       JOIN users u ON u.id = a.user_id
       WHERE ($1::boolean = FALSE OR a.role <> 'SUPER_ADMIN')
       ORDER BY u.id DESC`
      ,
      [isAdminRequester]
    );
    return res.json(rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load tài khoản", error: error.message });
  }
});

app.put("/auth/accounts/:id/role", authenticate, authorize("SUPER_ADMIN", "ADMIN"), async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const normalizedRole = normalizeRole(req.body?.role);

    if (!USER_ROLES.includes(normalizedRole)) {
      return res.status(400).json({ message: "Invalid role" });
    }
    const targetRole = await getAccountRoleByUserId(userId);
    if (!targetRole) {
      return res.status(404).json({ message: "Account not found" });
    }
    if (targetRole === "SUPER_ADMIN" && req.user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Super admin account is protected from management" });
    }
    if (req.user.role === "ADMIN" && targetRole === "ADMIN" && Number(req.user.sub) !== userId) {
      return res.status(403).json({ message: "Admin cannot modify another admin account" });
    }
    if (req.user.role === "ADMIN" && normalizedRole === "SUPER_ADMIN") {
      return res.status(403).json({ message: "Only super admin can assign SUPER_ADMIN role" });
    }
    if (req.user.role === "ADMIN" && normalizedRole === "ADMIN" && targetRole !== "ADMIN") {
      return res.status(403).json({ message: "Admin cannot grant ADMIN role" });
    }
    if (Number(req.user.sub) === userId && normalizedRole !== targetRole) {
      return res.status(403).json({ message: "You cannot change your own role" });
    }
    if (normalizedRole === "SUPER_ADMIN" && await hasAnotherSuperAdmin(userId)) {
      return res.status(409).json({ message: "Only one SUPER_ADMIN account is allowed" });
    }

    const result = await pool.query(
      "UPDATE accounts SET role = $1, updated_at = NOW() WHERE user_id = $2 RETURNING user_id AS id, role",
      [normalizedRole, userId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Account not found" });
    }

    await writeDataLog({
      action: "update",
      collection: "account-role",
      recordId: String(userId),
      username: req.user.email,
      metadata: { role: normalizedRole }
    });

    return res.json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Cập nhật vai trò failed", error: error.message });
  }
});

app.put("/auth/accounts/:id/status", authenticate, authorize("SUPER_ADMIN", "ADMIN"), async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const { accountStatus, lockMinutes } = req.body;

    if (!ACCOUNT_STATUSES.includes(accountStatus)) {
      return res.status(400).json({ message: "Invalid account status" });
    }
    const targetRole = await getAccountRoleByUserId(userId);
    if (!targetRole) {
      return res.status(404).json({ message: "Account not found" });
    }
    if (targetRole === "SUPER_ADMIN" && req.user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Super admin account is protected from management" });
    }
    if (req.user.role === "ADMIN" && targetRole === "ADMIN" && Number(req.user.sub) !== userId) {
      return res.status(403).json({ message: "Admin cannot modify another admin account" });
    }
    if (Number(req.user.sub) === userId && accountStatus !== "ACTIVE") {
      return res.status(403).json({ message: "You cannot lock or deactivate your own account" });
    }

    let lockUntil = null;
    if (accountStatus === "LOCKED") {
      const minutes = Number(lockMinutes || LOCK_MINUTES);
      if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 10080) {
        return res.status(400).json({ message: "lockMinutes phải nằm trong khoảng từ 1 đến 10080" });
      }
      lockUntil = new Date(Date.now() + minutes * 60 * 1000);
    }

    const result = await pool.query(
      `UPDATE accounts
       SET account_status = $1::varchar,
           failed_login_attempts = CASE WHEN $1::text = 'ACTIVE' THEN 0 ELSE failed_login_attempts END,
           locked_until = CASE
             WHEN $1::text = 'LOCKED' THEN $2
             WHEN $1::text = 'ACTIVE' THEN NULL
             ELSE locked_until
           END,
           updated_at = NOW()
       WHERE user_id = $3
       RETURNING user_id AS id, account_status, failed_login_attempts, locked_until`,
      [accountStatus, lockUntil, userId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Account not found" });
    }

    await writeDataLog({
      action: "update",
      collection: "account-status",
      recordId: String(userId),
      username: req.user.email,
      metadata: { accountStatus, lockUntil }
    });

    return res.json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Cập nhật trạng thái failed", error: error.message });
  }
});

app.put("/auth/accounts/:id/password", authenticate, authorize("SUPER_ADMIN", "ADMIN"), async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const { newPassword, unlockAccount } = req.body;
    if (!newPassword || String(newPassword).length < 6) {
      return res.status(400).json({ message: "newPassword là trường bắt buộc và phải có ít nhất 6 ký tự" });
    }
    const targetRole = await getAccountRoleByUserId(userId);
    if (!targetRole) {
      return res.status(404).json({ message: "Account not found" });
    }
    if (targetRole === "SUPER_ADMIN" && req.user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Super admin account is protected from management" });
    }
    if (req.user.role === "ADMIN" && targetRole === "ADMIN" && Number(req.user.sub) !== userId) {
      return res.status(403).json({ message: "Admin cannot modify another admin account" });
    }

    const passwordHash = await bcrypt.hash(String(newPassword), 10);
    const result = await pool.query(
      `UPDATE accounts
       SET password_hash = $1,
           password_changed_at = NOW(),
           failed_login_attempts = 0,
           locked_until = CASE WHEN $2::boolean THEN NULL ELSE locked_until END,
           account_status = CASE WHEN $2::boolean AND account_status = 'LOCKED' THEN 'ACTIVE' ELSE account_status END,
           updated_at = NOW()
       WHERE user_id = $3
       RETURNING user_id AS id, account_status, password_changed_at`,
      [passwordHash, Boolean(unlockAccount), userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Account not found" });
    }

    await writeDataLog({
      action: "update",
      collection: "account-password",
      recordId: String(userId),
      username: req.user.email,
      metadata: { unlockAccount: Boolean(unlockAccount) }
    });

    return res.json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Cập nhật mật khẩu failed", error: error.message });
  }
});

app.put("/auth/users/:id/role", authenticate, authorize("SUPER_ADMIN", "ADMIN"), async (req, res) => {
  try {
    const userId = Number(req.params.id);
    const normalizedRole = normalizeRole(req.body?.role);

    if (!USER_ROLES.includes(normalizedRole)) {
      return res.status(400).json({ message: "Invalid role" });
    }

    const targetRole = await getAccountRoleByUserId(userId);
    if (!targetRole) {
      return res.status(404).json({ message: "Account not found" });
    }
    if (targetRole === "SUPER_ADMIN" && req.user.role !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Super admin account is protected from management" });
    }
    if (req.user.role === "ADMIN" && targetRole === "ADMIN" && Number(req.user.sub) !== userId) {
      return res.status(403).json({ message: "Admin cannot modify another admin account" });
    }
    if (req.user.role === "ADMIN" && normalizedRole === "SUPER_ADMIN") {
      return res.status(403).json({ message: "Only super admin can assign SUPER_ADMIN role" });
    }
    if (req.user.role === "ADMIN" && normalizedRole === "ADMIN" && targetRole !== "ADMIN") {
      return res.status(403).json({ message: "Admin cannot grant ADMIN role" });
    }
    if (Number(req.user.sub) === userId && normalizedRole !== targetRole) {
      return res.status(403).json({ message: "You cannot change your own role" });
    }
    if (normalizedRole === "SUPER_ADMIN" && await hasAnotherSuperAdmin(userId)) {
      return res.status(409).json({ message: "Only one SUPER_ADMIN account is allowed" });
    }

    const result = await pool.query(
      "UPDATE accounts SET role = $1, updated_at = NOW() WHERE user_id = $2 RETURNING user_id AS id, role",
      [normalizedRole, userId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Account not found" });
    }
    return res.json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Cập nhật vai trò failed", error: error.message });
  }
});

ensureAuthSchema()
  .then(() => {
    app.listen(port, () => {
      console.log(`auth-service listening on ${port}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize auth service:", error.message);
    process.exit(1);
  });




