require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();
const port = Number(process.env.ATTENDANCE_SERVICE_PORT || 3004);
const MAX_DISTANCE_METERS = Number(process.env.GPS_RADIUS_METERS || 100);

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
app.use(express.json({ limit: "12mb" }));

async function writeDataLog({ action, collection, recordId, username, metadata }) {
  try {
    await pool.query(
      `INSERT INTO data_logs (service_name, action, collection, record_id, username, metadata)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      ["attendance-service", action, collection, recordId || null, username || null, metadata || null]
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

function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// MVP face matcher: compare uploaded string with stored template prefix overlap.
function faceMatchScore(storedTemplate, probeTemplate) {
  if (!storedTemplate || !probeTemplate) {
    return 0;
  }
  const maxLen = Math.min(storedTemplate.length, probeTemplate.length, 500);
  if (maxLen === 0) {
    return 0;
  }

  let matched = 0;
  for (let i = 0; i < maxLen; i += 1) {
    if (storedTemplate[i] === probeTemplate[i]) {
      matched += 1;
    }
  }
  return matched / maxLen;
}

app.get("/health", (req, res) => {
  res.json({ service: "attendance-service", status: "ok" });
});

app.post("/attendance/check-in", authenticate, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { projectId, latitude, longitude, faceTemplate } = req.body;

    if (!projectId || latitude == null || longitude == null || !faceTemplate) {
      return res.status(400).json({ message: "projectId, latitude, longitude, faceTemplate is required" });
    }

    const assignment = await pool.query(
      "SELECT * FROM project_assignments WHERE user_id = $1 AND project_id = $2",
      [userId, projectId]
    );

    if (assignment.rowCount === 0 && req.user.role === "EMPLOYEE") {
      return res.status(403).json({ message: "Employee is not assigned to this project" });
    }

    const projectResult = await pool.query("SELECT * FROM projects WHERE id = $1", [projectId]);
    if (projectResult.rowCount === 0) {
      return res.status(404).json({ message: "Project not found" });
    }

    const project = projectResult.rows[0];
    const distance = haversineDistanceMeters(latitude, longitude, project.latitude, project.longitude);
    if (distance > MAX_DISTANCE_METERS) {
      return res.status(400).json({
        message: "Outside allowed GPS radius",
        distanceMeters: Number(distance.toFixed(2)),
        allowedMeters: MAX_DISTANCE_METERS
      });
    }

    const userResult = await pool.query("SELECT id, face_template FROM users WHERE id = $1", [userId]);
    if (userResult.rowCount === 0) {
      return res.status(404).json({ message: "User not found" });
    }

    const score = faceMatchScore(userResult.rows[0].face_template, faceTemplate);
    if (score < 0.75) {
      return res.status(401).json({ message: "Xác thực khuôn mặt failed", score: Number(score.toFixed(4)) });
    }

    const existing = await pool.query(
      "SELECT * FROM attendance_logs WHERE user_id = $1 AND project_id = $2 AND check_out_time IS NULL",
      [userId, projectId]
    );
    if (existing.rowCount > 0) {
      return res.status(400).json({ message: "Already checked in and not checked out" });
    }

    const result = await pool.query(
      `INSERT INTO attendance_logs
      (user_id, project_id, check_in_time, check_in_latitude, check_in_longitude, face_score)
      VALUES ($1,$2,NOW(),$3,$4,$5)
      RETURNING *`,
      [userId, projectId, latitude, longitude, score]
    );

    await writeDataLog({
      action: "check-in",
      collection: "attendance",
      recordId: String(result.rows[0].id),
      username: req.user.email,
      metadata: {
        projectId,
        distanceMeters: Number(distance.toFixed(2)),
        score: Number(score.toFixed(4))
      }
    });

    return res.status(201).json({
      message: "Check-in successful",
      distanceMeters: Number(distance.toFixed(2)),
      data: result.rows[0]
    });
  } catch (error) {
    return res.status(500).json({ message: "Vào ca failed", error: error.message });
  }
});

app.post("/attendance/check-out", authenticate, async (req, res) => {
  try {
    const userId = req.user.sub;
    const { projectId, latitude, longitude } = req.body;

    if (!projectId || latitude == null || longitude == null) {
      return res.status(400).json({ message: "projectId, latitude, longitude is required" });
    }

    const result = await pool.query(
      `UPDATE attendance_logs
       SET check_out_time = NOW(),
           check_out_latitude = $1,
           check_out_longitude = $2
       WHERE user_id = $3 AND project_id = $4 AND check_out_time IS NULL
       RETURNING *`,
      [latitude, longitude, userId, projectId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: "No active check-in found" });
    }

    await writeDataLog({
      action: "check-out",
      collection: "attendance",
      recordId: String(result.rows[0].id),
      username: req.user.email,
      metadata: { projectId }
    });

    return res.json({ message: "Check-out successful", data: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: "Ra ca failed", error: error.message });
  }
});

app.get("/attendance/history", authenticate, async (req, res) => {
  try {
    const { userId, projectId, date } = req.query;

    const where = [];
    const values = [];

    if (req.user.role === "EMPLOYEE") {
      values.push(req.user.sub);
      where.push(`a.user_id = $${values.length}`);
    } else if (userId) {
      values.push(Number(userId));
      where.push(`a.user_id = $${values.length}`);
    }

    if (date) {
      values.push(date);
      where.push(`DATE(a.check_in_time) = $${values.length}`);
    }

    if (projectId) {
      values.push(Number(projectId));
      where.push(`a.project_id = $${values.length}`);
    }

    const condition = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const query = `
      SELECT a.*,
             COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.last_name, u.first_name)), ''), u.full_name) AS full_name,
             u.employee_code,
             p.name AS project_name
      FROM attendance_logs a
      JOIN users u ON a.user_id = u.id
      JOIN projects p ON a.project_id = p.id
      ${condition}
      ORDER BY a.created_at DESC
    `;

    const result = await pool.query(query, values);

    await writeDataLog({
      action: "read",
      collection: "attendance",
      recordId: "history",
      username: req.user.email,
      metadata: {
        count: result.rows.length,
        filteredByUserId: userId ? Number(userId) : null,
        filteredByProjectId: projectId ? Number(projectId) : null,
        filteredByDate: date || null
      }
    });

    return res.json(result.rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load lịch sử chấm công", error: error.message });
  }
});

app.post("/attendance/location", authenticate, authorize("EMPLOYEE", "MANAGER", "ADMIN"), async (req, res) => {
  try {
    const { projectId, latitude, longitude, source } = req.body;

    if (latitude == null || longitude == null) {
      return res.status(400).json({ message: "latitude và longitude is required" });
    }

    const resolvedProjectId = projectId || null;
    if (resolvedProjectId) {
      const projectExists = await pool.query("SELECT id FROM projects WHERE id = $1", [resolvedProjectId]);
      if (projectExists.rowCount === 0) {
        return res.status(404).json({ message: "Project not found" });
      }
    }

    const result = await pool.query(
      `INSERT INTO employee_locations (user_id, project_id, latitude, longitude, source)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.user.sub, resolvedProjectId, latitude, longitude, source || "GPS"]
    );

    await writeDataLog({
      action: "create",
      collection: "employee-location",
      recordId: String(result.rows[0].id),
      username: req.user.email,
      metadata: { projectId: resolvedProjectId }
    });

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to save location", error: error.message });
  }
});

app.get("/attendance/location/latest", authenticate, authorize("ADMIN", "MANAGER"), async (req, res) => {
  try {
    const { projectId, userId } = req.query;

    const where = [];
    const values = [];

    if (projectId) {
      values.push(Number(projectId));
      where.push(`el.project_id = $${values.length}`);
    }

    if (userId) {
      values.push(Number(userId));
      where.push(`el.user_id = $${values.length}`);
    }

    const condition = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const result = await pool.query(
      `SELECT DISTINCT ON (el.user_id)
         el.id,
         el.user_id,
         el.project_id,
         el.latitude,
         el.longitude,
         el.source,
         el.created_at,
         COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.last_name, u.first_name)), ''), u.full_name) AS full_name,
         u.employee_code,
         p.name AS project_name
       FROM employee_locations el
       JOIN users u ON el.user_id = u.id
       LEFT JOIN projects p ON el.project_id = p.id
       ${condition}
       ORDER BY el.user_id, el.created_at DESC`,
      values
    );

    await writeDataLog({
      action: "read",
      collection: "employee-location",
      recordId: "latest",
      username: req.user.email,
      metadata: { count: result.rows.length }
    });

    return res.json(result.rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load vị trí mới nhất", error: error.message });
  }
});

app.get("/attendance/reports/attendance-summary", authenticate, authorize("ADMIN", "MANAGER"), async (req, res) => {
  try {
    const { from, to } = req.query;

    const values = [];
    const where = [];
    if (from) {
      values.push(from);
      where.push(`a.check_in_time >= $${values.length}::timestamp`);
    }
    if (to) {
      values.push(to);
      where.push(`a.check_in_time <= $${values.length}::timestamp`);
    }

    const condition = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const result = await pool.query(
      `SELECT u.id AS user_id,
              u.employee_code,
              COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.last_name, u.first_name)), ''), u.full_name) AS full_name,
              COUNT(a.id) AS total_shifts,
              COUNT(a.check_out_time) AS completed_shifts,
              MIN(a.check_in_time) AS first_check_in,
              MAX(a.check_in_time) AS last_check_in
       FROM users u
       LEFT JOIN attendance_logs a ON u.id = a.user_id
       ${condition}
       GROUP BY u.id, u.employee_code, u.first_name, u.last_name, u.full_name
       ORDER BY COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.last_name, u.first_name)), ''), u.full_name) ASC`,
      values
    );

    await writeDataLog({
      action: "read",
      collection: "attendance-report",
      recordId: "attendance-summary",
      username: req.user.email,
      metadata: { count: result.rows.length, from: from || null, to: to || null }
    });

    return res.json(result.rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to build báo cáo chấm công", error: error.message });
  }
});

app.get("/attendance/reports/hr-summary", authenticate, authorize("ADMIN"), async (req, res) => {
  try {
    const [userSummary, projectSummary, attendanceSummary] = await Promise.all([
      pool.query(
        `SELECT role, COUNT(*)::int AS total
         FROM accounts
         GROUP BY role
         ORDER BY role`
      ),
      pool.query(
        `SELECT status, COUNT(*)::int AS total
         FROM projects
         GROUP BY status
         ORDER BY status`
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total_logs,
                COUNT(check_out_time)::int AS completed_logs
         FROM attendance_logs`
      )
    ]);

    await writeDataLog({
      action: "read",
      collection: "hr-report",
      recordId: "hr-summary",
      username: req.user.email
    });

    return res.json({
      usersByRole: userSummary.rows,
      projectsByStatus: projectSummary.rows,
      attendance: attendanceSummary.rows[0]
    });
  } catch (error) {
    return res.status(500).json({ message: "Failed to build báo cáo nhân sự", error: error.message });
  }
});

app.listen(port, () => {
  console.log(`attendance-service listening on ${port}`);
});



