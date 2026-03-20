require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();
const port = Number(process.env.NOTIFICATION_SERVICE_PORT || 3005);

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
      ["notification-service", action, collection, recordId || null, username || null, metadata || null]
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

app.get("/health", (req, res) => {
  res.json({ service: "notification-service", status: "ok" });
});

app.post("/notifications", authenticate, async (req, res) => {
  try {
    const { userId, title, message } = req.body;
    const targetUserId = userId || req.user.sub;

    if (!title || !message) {
      return res.status(400).json({ message: "title and message are required" });
    }

    if (req.user.role === "EMPLOYEE" && targetUserId !== req.user.sub) {
      return res.status(403).json({ message: "Forbidden" });
    }

    const result = await pool.query(
      "INSERT INTO notifications (user_id, title, message) VALUES ($1,$2,$3) RETURNING *",
      [targetUserId, title, message]
    );

    await writeDataLog({
      action: "create",
      collection: "notification",
      recordId: String(result.rows[0].id),
      username: req.user.email,
      metadata: { targetUserId }
    });

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to create notification", error: error.message });
  }
});

app.get("/notifications", authenticate, async (req, res) => {
  try {
    const userId = req.user.role === "EMPLOYEE" ? req.user.sub : Number(req.query.userId || req.user.sub);
    const result = await pool.query(
      "SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC",
      [userId]
    );

    await writeDataLog({
      action: "read",
      collection: "notification",
      recordId: "list",
      username: req.user.email,
      metadata: { userId, count: result.rows.length }
    });

    return res.json(result.rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to fetch notifications", error: error.message });
  }
});

app.put("/notifications/:id/read", authenticate, async (req, res) => {
  try {
    const notificationId = Number(req.params.id);
    const result = await pool.query(
      `UPDATE notifications
       SET status = 'READ'
       WHERE id = $1 AND user_id = $2
       RETURNING *`,
      [notificationId, req.user.sub]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Notification not found" });
    }

    await writeDataLog({
      action: "update",
      collection: "notification",
      recordId: String(notificationId),
      username: req.user.email,
      metadata: { status: "READ" }
    });

    return res.json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to update notification", error: error.message });
  }
});

app.listen(port, () => {
  console.log(`notification-service listening on ${port}`);
});
