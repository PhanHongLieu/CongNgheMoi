require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();
const port = Number(process.env.PORT || process.env.ATTENDANCE_SERVICE_PORT || 3004);
const MAX_DISTANCE_METERS = Number(process.env.GPS_RADIUS_METERS || 100);
const EMBEDDING_PASS_THRESHOLD = Number(process.env.FACE_EMBEDDING_THRESHOLD || 0.88);
const SIGNATURE_PASS_THRESHOLD = Number(process.env.FACE_SIGNATURE_THRESHOLD || 0.76);
const LIVENESS_PASS_THRESHOLD = Number(process.env.FACE_LIVENESS_THRESHOLD || 0.2);
const FACE_IMPOSTOR_EMBEDDING_MARGIN = Number(process.env.FACE_IMPOSTOR_EMBEDDING_MARGIN || 0.01);
const FACE_IMPOSTOR_SIGNATURE_MARGIN = Number(process.env.FACE_IMPOSTOR_SIGNATURE_MARGIN || 0.02);
const FACE_IMPOSTOR_MIN_POOL = Number(process.env.FACE_IMPOSTOR_MIN_POOL || 8);
const FACE_IMPOSTOR_ABSOLUTE_FLOOR = Number(process.env.FACE_IMPOSTOR_ABSOLUTE_FLOOR || 0.93);
const STANDARD_WORK_HOURS = Number(process.env.TIMESHEET_STANDARD_HOURS || 8);
const HALF_WORK_HOURS = Number(process.env.TIMESHEET_HALF_DAY_HOURS || 4);
const DEFAULT_LUNCH_BREAK_HOURS = Number(process.env.TIMESHEET_LUNCH_BREAK_HOURS || 1.5);

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "change_access_secret";
const TOKEN_ISSUER = process.env.TOKEN_ISSUER || "mdp-system";

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

async function ensureAttendanceSchema() {
  await pool.query(`
    ALTER TABLE attendance_logs
      ADD COLUMN IF NOT EXISTS face_mode VARCHAR(30),
      ADD COLUMN IF NOT EXISTS liveness_score NUMERIC(6,4),
      ADD COLUMN IF NOT EXISTS attendance_status VARCHAR(20),
      ADD COLUMN IF NOT EXISTS note TEXT,
      ADD COLUMN IF NOT EXISTS is_within_geofence_in BOOLEAN,
      ADD COLUMN IF NOT EXISTS gps_distance_in_m NUMERIC(10,2),
      ADD COLUMN IF NOT EXISTS is_within_geofence_out BOOLEAN,
      ADD COLUMN IF NOT EXISTS gps_distance_out_m NUMERIC(10,2),
      ADD COLUMN IF NOT EXISTS captured_device VARCHAR(80)
  `);
  await pool.query("ALTER TABLE attendance_logs DROP CONSTRAINT IF EXISTS attendance_logs_attendance_status_check");
  await pool.query(`
    ALTER TABLE attendance_logs
    ADD CONSTRAINT attendance_logs_attendance_status_check
    CHECK (attendance_status IN ('PRESENT', 'LATE', 'EARLY_LEAVE', 'ABSENT', 'ON_LEAVE', 'OPEN', 'COMPLETED', 'MISSING_OUT', 'INVALID', 'PENDING_OT_APPROVAL'))
  `);
  await pool.query(`
    UPDATE attendance_logs
    SET attendance_status = CASE
      WHEN check_out_time IS NOT NULL THEN 'COMPLETED'
      WHEN check_in_time::date < CURRENT_DATE THEN 'MISSING_OUT'
      ELSE 'OPEN'
    END
    WHERE attendance_status IS NULL
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS timesheets (
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
    )
  `);
  await pool.query("CREATE INDEX IF NOT EXISTS idx_timesheets_user_work_date ON timesheets (user_id, work_date)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_timesheets_status ON timesheets (timesheet_status)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_timesheets_project_work_date ON timesheets (project_id, work_date)");
}

async function markMissingCheckouts() {
  await pool.query(`
    UPDATE attendance_logs
    SET attendance_status = 'MISSING_OUT'
    WHERE check_out_time IS NULL
      AND check_in_time::date < CURRENT_DATE
      AND COALESCE(attendance_status, 'OPEN') <> 'MISSING_OUT'
  `);
}

function round2(value) {
  return Number((Number(value || 0)).toFixed(2));
}

function computeTimesheetMetrics(row) {
  const checkIn = row.check_in_time ? new Date(row.check_in_time) : null;
  const checkOut = row.check_out_time ? new Date(row.check_out_time) : null;
  const shiftCode = String(row.shift_code || "DAY_SHIFT").toUpperCase();
  const shiftStartTime = String(row.shift_start_time || "").slice(0, 5);
  const shiftEndTime = String(row.shift_end_time || "").slice(0, 5);
  const isMissingOut = !checkOut && checkIn && new Date(checkIn.toISOString().slice(0, 10)) < new Date(new Date().toISOString().slice(0, 10));
  if (!checkIn || !checkOut || isMissingOut) {
    return {
      rawWorkHours: 0,
      breakHours: 0,
      actualHours: 0,
      workingDayValue: 0,
      otHours: 0,
      timesheetStatus: isMissingOut ? "MISSING_OUT" : "PENDING",
      note: isMissingOut ? "Missing check-out. Awaiting approved request." : "Pending check-out."
    };
  }

  const rawWorkHours = Math.max((checkOut.getTime() - checkIn.getTime()) / 3600000, 0);
  const breakHours = rawWorkHours >= 6 ? DEFAULT_LUNCH_BREAK_HOURS : 0;
  const actualHours = Math.max(rawWorkHours - breakHours, 0);
  const workingDayValue = actualHours >= STANDARD_WORK_HOURS ? 1 : actualHours >= HALF_WORK_HOURS ? 0.5 : 0;

  const [startHour, startMinute] = shiftStartTime.split(":").map((value) => Number(value));
  const [endHour, endMinute] = shiftEndTime.split(":").map((value) => Number(value));
  const threshold = new Date(checkIn);
  const fallbackEndHour = shiftCode === "NIGHT_SHIFT" ? 4 : 17;
  const fallbackEndMinute = 0;
  threshold.setHours(
    Number.isFinite(endHour) ? endHour : fallbackEndHour,
    Number.isFinite(endMinute) ? endMinute : fallbackEndMinute,
    0,
    0
  );
  const isOvernightShift =
    shiftCode === "NIGHT_SHIFT" ||
    (Number.isFinite(startHour) &&
      Number.isFinite(endHour) &&
      (endHour < startHour || (endHour === startHour && Number(endMinute || 0) <= Number(startMinute || 0))));
  if (isOvernightShift) {
    threshold.setDate(threshold.getDate() + 1);
  }
  const otHours = Math.max((checkOut.getTime() - threshold.getTime()) / 3600000, 0);

  return {
    rawWorkHours: round2(rawWorkHours),
    breakHours: round2(breakHours),
    actualHours: round2(actualHours),
    workingDayValue: round2(workingDayValue),
    otHours: round2(otHours),
    timesheetStatus: "READY",
    note: null
  };
}

async function upsertTimesheetForAttendanceRow(row) {
  const metrics = computeTimesheetMetrics(row);
  const workDate = row.check_in_time ? new Date(row.check_in_time).toISOString().slice(0, 10) : null;
  await pool.query(
    `INSERT INTO timesheets
    (attendance_log_id, user_id, project_id, work_date, check_in_time, check_out_time, raw_work_hours, break_hours, actual_hours, working_day_value, ot_hours, timesheet_status, source, notes, computed_at, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'SYSTEM',$13,NOW(),NOW())
    ON CONFLICT (attendance_log_id)
    DO UPDATE SET
      user_id = EXCLUDED.user_id,
      project_id = EXCLUDED.project_id,
      work_date = EXCLUDED.work_date,
      check_in_time = EXCLUDED.check_in_time,
      check_out_time = EXCLUDED.check_out_time,
      raw_work_hours = EXCLUDED.raw_work_hours,
      break_hours = EXCLUDED.break_hours,
      actual_hours = EXCLUDED.actual_hours,
      working_day_value = EXCLUDED.working_day_value,
      ot_hours = EXCLUDED.ot_hours,
      timesheet_status = EXCLUDED.timesheet_status,
      notes = EXCLUDED.notes,
      computed_at = NOW(),
      updated_at = NOW()`,
    [
      row.id,
      row.user_id,
      row.project_id,
      workDate,
      row.check_in_time,
      row.check_out_time,
      metrics.rawWorkHours,
      metrics.breakHours,
      metrics.actualHours,
      metrics.workingDayValue,
      metrics.otHours,
      metrics.timesheetStatus,
      metrics.note
    ]
  );
}

async function recomputeTimesheets() {
  const { rows } = await pool.query(`
    SELECT
      al.id,
      al.user_id,
      al.project_id,
      al.check_in_time,
      al.check_out_time,
      al.attendance_status,
      ws.shift_code,
      ws.shift_start_time,
      ws.shift_end_time
    FROM attendance_logs al
    LEFT JOIN employee_work_schedules ws
      ON ws.user_id = al.user_id
     AND ws.project_id = al.project_id
     AND ws.work_date = DATE(al.check_in_time)
    WHERE al.check_in_time IS NOT NULL
    ORDER BY al.id ASC, ws.updated_at DESC NULLS LAST
  `);

  const uniqueRows = [];
  const seen = new Set();
  for (const row of rows) {
    if (seen.has(row.id)) {
      continue;
    }
    seen.add(row.id);
    uniqueRows.push(row);
  }

  for (const row of uniqueRows) {
    const metrics = computeTimesheetMetrics(row);
    const workDate = row.check_in_time ? new Date(row.check_in_time).toISOString().slice(0, 10) : null;
    await pool.query(
      `INSERT INTO timesheets
      (attendance_log_id, user_id, project_id, work_date, check_in_time, check_out_time, raw_work_hours, break_hours, actual_hours, working_day_value, ot_hours, timesheet_status, source, notes, computed_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'SYSTEM',$13,NOW(),NOW())
      ON CONFLICT (attendance_log_id)
      DO UPDATE SET
        user_id = EXCLUDED.user_id,
        project_id = EXCLUDED.project_id,
        work_date = EXCLUDED.work_date,
        check_in_time = EXCLUDED.check_in_time,
        check_out_time = EXCLUDED.check_out_time,
        raw_work_hours = EXCLUDED.raw_work_hours,
        break_hours = EXCLUDED.break_hours,
        actual_hours = EXCLUDED.actual_hours,
        working_day_value = EXCLUDED.working_day_value,
        ot_hours = EXCLUDED.ot_hours,
        timesheet_status = EXCLUDED.timesheet_status,
        notes = EXCLUDED.notes,
        computed_at = NOW(),
        updated_at = NOW()
      `,
      [
        row.id,
        row.user_id,
        row.project_id,
        workDate,
        row.check_in_time,
        row.check_out_time,
        metrics.rawWorkHours,
        metrics.breakHours,
        metrics.actualHours,
        metrics.workingDayValue,
        metrics.otHours,
        metrics.timesheetStatus,
        metrics.note
      ]
    );
  }
}

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
  } catch {
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

function toNumber(input) {
  const value = Number(input);
  return Number.isFinite(value) ? value : null;
}

function parseTimestamp(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toISOString();
}

function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const earthRadius = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return earthRadius * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

function normalizeEmbeddingVector(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  const values = input.map((item) => Number(item)).filter((item) => Number.isFinite(item));
  if (values.length !== 128 && values.length !== 512) {
    return [];
  }
  const norm = Math.sqrt(values.reduce((sum, item) => sum + item * item, 0));
  if (!norm) {
    return [];
  }
  return values.map((item) => Number((item / norm).toFixed(6)));
}

function normalizeFaceSignature(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^0-9a-f]/g, "");
}

function parseFaceTemplate(rawTemplate) {
  try {
    const parsed = typeof rawTemplate === "object" && rawTemplate !== null
      ? rawTemplate
      : JSON.parse(String(rawTemplate || "{}"));
    const embeddings = [];
    const signatures = [];
    const primaryEmbedding = normalizeEmbeddingVector(parsed?.primaryEmbedding);
    if (primaryEmbedding.length > 0) {
      embeddings.push(primaryEmbedding);
    }

    if (parsed?.embeddings && typeof parsed.embeddings === "object") {
      for (const value of Object.values(parsed.embeddings)) {
        const vector = normalizeEmbeddingVector(value);
        if (vector.length > 0) {
          embeddings.push(vector);
        }
      }
    }

    const primarySignature = normalizeFaceSignature(parsed?.primarySignature);
    if (primarySignature) {
      signatures.push(primarySignature);
    }
    if (parsed?.signatures && typeof parsed.signatures === "object") {
      for (const value of Object.values(parsed.signatures)) {
        const signature = normalizeFaceSignature(value);
        if (signature) {
          signatures.push(signature);
        }
      }
    }

    return {
      embeddings,
      signatures: [...new Set(signatures)]
    };
  } catch {
    return { embeddings: [], signatures: [] };
  }
}

function cosineSimilarity(vecA, vecB) {
  if (!Array.isArray(vecA) || !Array.isArray(vecB) || vecA.length === 0 || vecA.length !== vecB.length) {
    return 0;
  }
  let dot = 0;
  for (let i = 0; i < vecA.length; i += 1) {
    dot += vecA[i] * vecB[i];
  }
  return dot;
}
const HEX_POPCOUNT = {
  "0": 0, "1": 1, "2": 1, "3": 2, "4": 1, "5": 2, "6": 2, "7": 3,
  "8": 1, "9": 2, a: 2, b: 3, c: 2, d: 3, e: 3, f: 4
};

function hexHammingSimilarity(signatureA, signatureB) {
  const a = normalizeFaceSignature(signatureA);
  const b = normalizeFaceSignature(signatureB);
  const len = Math.min(a.length, b.length);
  if (len === 0) {
    return 0;
  }

  let distance = 0;
  for (let i = 0; i < len; i += 1) {
    const xor = (parseInt(a[i], 16) ^ parseInt(b[i], 16)).toString(16);
    distance += HEX_POPCOUNT[xor] || 0;
  }
  const maxBits = len * 4;
  return maxBits > 0 ? 1 - distance / maxBits : 0;
}

function faceMatchScore(storedTemplate, probeEmbedding, probeSignature) {
  const incomingEmbedding = normalizeEmbeddingVector(probeEmbedding);
  const incomingSignature = normalizeFaceSignature(probeSignature);
  const parsedStored = parseFaceTemplate(storedTemplate);

  if (incomingEmbedding.length > 0 && parsedStored.embeddings.length > 0) {
    const compatibleEmbeddings = parsedStored.embeddings.filter((item) => item.length === incomingEmbedding.length);
    if (compatibleEmbeddings.length > 0) {
      let bestScore = 0;
      for (const vector of compatibleEmbeddings) {
        const score = cosineSimilarity(vector, incomingEmbedding);
        if (score > bestScore) {
          bestScore = score;
        }
      }
      return { mode: `embedding_${incomingEmbedding.length}d`, score: bestScore, threshold: EMBEDDING_PASS_THRESHOLD };
    }
  }
  if (incomingSignature && parsedStored.signatures.length > 0) {
    let bestScore = 0;
    for (const signature of parsedStored.signatures) {
      const score = hexHammingSimilarity(signature, incomingSignature);
      if (score > bestScore) {
        bestScore = score;
      }
    }
    return { mode: "signature", score: bestScore, threshold: SIGNATURE_PASS_THRESHOLD };
  }
  return { mode: "none", score: 0, threshold: 1 };
}

function findBestImpostorScores(rows, incomingEmbedding, incomingSignature) {
  let bestEmbeddingScore = 0;
  let bestSignatureScore = 0;

  for (const row of rows) {
    const template = row?.face_template;
    if (!template) {
      continue;
    }
    const embeddingScore = faceMatchScore(template, incomingEmbedding, "");
    const signatureScore = faceMatchScore(template, [], incomingSignature);
    if (embeddingScore.mode !== "none" && embeddingScore.score > bestEmbeddingScore) {
      bestEmbeddingScore = embeddingScore.score;
    }
    if (signatureScore.mode !== "none" && signatureScore.score > bestSignatureScore) {
      bestSignatureScore = signatureScore.score;
    }
  }

  return { bestEmbeddingScore, bestSignatureScore };
}

function validateLivenessPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return { passed: false, message: "Liveness data is required" };
  }
  const type = String(payload.type || "").trim();
  const passed = Boolean(payload.passed);
  const score = toNumber(payload.score);
  const requiredCount = toNumber(payload.requiredCount);
  const completedCount = toNumber(payload.completedCount);
  const elapsedMs = toNumber(payload.elapsedMs);
  const observedFrames = toNumber(payload.observedFrames);
  const movementScore = toNumber(payload.movementScore);
  const eyeOpenDelta = toNumber(payload.eyeOpenDelta);
  const happyScoreMax = toNumber(payload.happyScoreMax);
  const challengeActions = Array.isArray(payload.challengeActions)
    ? payload.challengeActions.map((item) => String(item || "").trim().toUpperCase()).filter(Boolean)
    : [];
  const completedEvents = Array.isArray(payload.completedEvents) ? payload.completedEvents : [];

  if (!passed) {
    return { passed: false, message: "Liveness verification failed on client" };
  }
  if (score == null || score < LIVENESS_PASS_THRESHOLD) {
    return { passed: false, message: "Liveness score is too low" };
  }

  if (type !== "ACTIVE_CHALLENGE_V2" && type !== "PASSIVE_FAST_V1") {
    return { passed: false, message: "Unsupported liveness type" };
  }
  if (requiredCount == null || completedCount == null || completedCount < requiredCount || requiredCount < 2) {
    if (type !== "PASSIVE_FAST_V1") {
      return { passed: false, message: "Liveness challenge is incomplete" };
    }
  }
  if (challengeActions.length !== requiredCount) {
    if (type !== "PASSIVE_FAST_V1") {
      return { passed: false, message: "Liveness challenge actions are invalid" };
    }
  }
  if (completedEvents.length !== completedCount) {
    if (type !== "PASSIVE_FAST_V1") {
      return { passed: false, message: "Liveness challenge events are inconsistent" };
    }
  }
  if (type === "ACTIVE_CHALLENGE_V2") {
    const validHead = challengeActions.some(
      (action) => action === "TURN_LEFT" || action === "TURN_RIGHT" || action === "TURN_SIDE"
    );
    const validExpression = challengeActions.some((action) => action === "BLINK" || action === "SMILE");
    if (!validHead || !validExpression) {
      return { passed: false, message: "Liveness challenge does not cover required actions" };
    }
  }
  if (elapsedMs == null || elapsedMs < 800 || elapsedMs > 18000) {
    return { passed: false, message: "Liveness challenge timing is invalid" };
  }
  const minFrames = type === "PASSIVE_FAST_V1" ? 1 : 6;
  if (observedFrames == null || observedFrames < minFrames) {
    return { passed: false, message: "Insufficient liveness frames" };
  }
  if (type !== "PASSIVE_FAST_V1") {
    const minMovement = 0.03;
    if (movementScore == null || movementScore < minMovement) {
      return { passed: false, message: "Head movement is insufficient" };
    }
  }
  const minEyeDelta = type === "PASSIVE_FAST_V1" ? 0.005 : 0.02;
  const minHappy = type === "PASSIVE_FAST_V1" ? 0.2 : 0.5;
  if (
    type !== "PASSIVE_FAST_V1" &&
    (eyeOpenDelta == null || eyeOpenDelta < minEyeDelta) &&
    (happyScoreMax == null || happyScoreMax < minHappy)
  ) {
    return { passed: false, message: "No strong expression/eye signal detected" };
  }

  return {
    passed: true,
    score,
    requiredCount,
    completedCount,
    observedFrames,
    movementScore,
    eyeOpenDelta,
    happyScoreMax
  };
}

async function resolveProject(projectId, latitude, longitude) {
  const projectResult = await pool.query("SELECT * FROM projects WHERE id = $1", [projectId]);
  if (projectResult.rowCount === 0) {
    return { error: { code: 404, message: "Project not found" } };
  }

  const project = projectResult.rows[0];
  if (project.project_code === "PRJ-GPS-TEST") {
    await pool.query(
      "UPDATE projects SET latitude = $1, longitude = $2, updated_at = NOW() WHERE id = $3",
      [latitude, longitude, project.id]
    );
    project.latitude = latitude;
    project.longitude = longitude;
  }
  return { project };
}

async function assertProjectAssignment(userId, projectId, role) {
  if (role !== "EMPLOYEE") {
    return { ok: true };
  }
  const assignment = await pool.query(
    "SELECT id FROM project_assignments WHERE user_id = $1 AND project_id = $2",
    [userId, projectId]
  );
  if (assignment.rowCount === 0) {
    return { ok: false, message: "Employee is not assigned to this project" };
  }
  return { ok: true };
}

async function getTodaySchedule(userId) {
  const result = await pool.query(
    `SELECT project_id, status
     FROM employee_work_schedules
     WHERE user_id = $1
       AND work_date = CURRENT_DATE
     ORDER BY shift_start_time ASC, id ASC
     LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

async function verifyFaceForUser(userId, incomingEmbedding, incomingSignature, faceLiveness) {
  if (!Array.isArray(incomingEmbedding)) {
    return { ok: false, code: 400, message: "faceEmbedding is required" };
  }
  const normalizedSignature = normalizeFaceSignature(incomingSignature);
  if (!normalizedSignature) {
    return { ok: false, code: 400, message: "faceSignature is required" };
  }
  const normalizedIncoming = normalizeEmbeddingVector(incomingEmbedding);
  if (normalizedIncoming.length === 0) {
    return { ok: false, code: 400, message: "faceEmbedding is invalid" };
  }

  const userResult = await pool.query("SELECT id, face_template, COALESCE(face_enrollment_status, 'UNREGISTERED') AS face_enrollment_status FROM users WHERE id = $1", [userId]);
  if (userResult.rowCount === 0) {
    return { ok: false, code: 404, message: "User not found" };
  }

  const storedTemplate = userResult.rows[0].face_template;
  if (!storedTemplate) {
    return { ok: false, code: 400, message: "Face template not registered. Please complete face enrollment first." };
  }
  if (userResult.rows[0].face_enrollment_status !== "APPROVED") {
    return { ok: false, code: 403, message: "Face enrollment is not approved by HR yet." };
  }

  const livenessResult = validateLivenessPayload(faceLiveness);
  if (!livenessResult.passed) {
    return { ok: false, code: 401, message: livenessResult.message };
  }

  const embeddingMatch = faceMatchScore(storedTemplate, normalizedIncoming, "");
  const signatureMatch = faceMatchScore(storedTemplate, [], normalizedSignature);
  if (embeddingMatch.mode === "none" || signatureMatch.mode === "none") {
    return { ok: false, code: 400, message: "Face template format is incompatible. Please re-enroll face template." };
  }
  if (embeddingMatch.score < embeddingMatch.threshold || signatureMatch.score < signatureMatch.threshold) {
    return {
      ok: false,
      code: 401,
      message: "Face verification failed",
      detail: {
        embeddingScore: Number(embeddingMatch.score.toFixed(4)),
        embeddingThreshold: Number(embeddingMatch.threshold.toFixed(4)),
        signatureScore: Number(signatureMatch.score.toFixed(4)),
        signatureThreshold: Number(signatureMatch.threshold.toFixed(4))
      }
    };
  }

  const impostorRows = await pool.query(
    "SELECT face_template FROM users WHERE id <> $1 AND face_template IS NOT NULL AND COALESCE(face_enrollment_status, 'UNREGISTERED') = 'APPROVED'",
    [userId]
  );
  const impostorScores = findBestImpostorScores(impostorRows.rows || [], normalizedIncoming, normalizedSignature);
  const impostorPoolSize = Array.isArray(impostorRows.rows) ? impostorRows.rows.length : 0;
  if (impostorPoolSize >= FACE_IMPOSTOR_MIN_POOL) {
    const embeddingAmbiguous =
      impostorScores.bestEmbeddingScore >= FACE_IMPOSTOR_ABSOLUTE_FLOOR &&
      impostorScores.bestEmbeddingScore >= embeddingMatch.score - FACE_IMPOSTOR_EMBEDDING_MARGIN;
    const signatureAmbiguous =
      impostorScores.bestSignatureScore >= FACE_IMPOSTOR_ABSOLUTE_FLOOR &&
      impostorScores.bestSignatureScore >= signatureMatch.score - FACE_IMPOSTOR_SIGNATURE_MARGIN;
    if (embeddingAmbiguous && signatureAmbiguous) {
      return {
        ok: false,
        code: 401,
        message: "Face verification ambiguous. Please re-enroll with clearer samples."
      };
    }
  }

  return { ok: true, matchResult: embeddingMatch, signatureMatch, livenessResult };
}

app.get("/health", (req, res) => {
  return res.json({
    service: "attendance-service",
    status: "ok",
    mode: "embedding-first"
  });
});

app.post("/attendance/check-in", authenticate, async (req, res) => {
  try {
    const userId = req.user.sub;
    const projectId = toNumber(req.body.projectId);
    const latitude = toNumber(req.body.latitude);
    const longitude = toNumber(req.body.longitude);
    const incomingEmbedding = req.body.faceEmbedding;
    const incomingSignature = req.body.faceSignature;
    const faceLiveness = req.body.faceLiveness;

    if (projectId == null || latitude == null || longitude == null) {
      return res.status(400).json({ message: "projectId, latitude, longitude are required" });
    }
    if (!Array.isArray(incomingEmbedding)) {
      return res.status(400).json({ message: "faceEmbedding is required" });
    }
    const todaySchedule = await getTodaySchedule(userId);
    if (!todaySchedule) {
      return res.status(403).json({ message: "No schedule found for today. Please contact your project manager." });
    }
    const scheduleStatus = String(todaySchedule.status || "").toUpperCase();
    const isDayOffOrLeave = scheduleStatus === "DAY_OFF" || scheduleStatus === "LEAVE";
    const allowOtCheckIn = Boolean(req.body.allowOtCheckIn);
    const otReason = String(req.body.otReason || "").trim();
    if (isDayOffOrLeave && !allowOtCheckIn) {
      return res.status(403).json({ message: "Today is your day off/leave. Press Check-in to submit OT request automatically." });
    }
    if (isDayOffOrLeave && !otReason) {
      return res.status(400).json({ message: "OT reason is required for day-off check-in." });
    }
    if (Number(todaySchedule.project_id) !== Number(projectId)) {
      return res.status(403).json({ message: "Project does not match your assigned schedule for today." });
    }

    const assignmentResult = await assertProjectAssignment(userId, projectId, req.user.role);
    if (!assignmentResult.ok) {
      return res.status(403).json({ message: assignmentResult.message });
    }

    const projectResult = await resolveProject(projectId, latitude, longitude);
    if (projectResult.error) {
      return res.status(projectResult.error.code).json({ message: projectResult.error.message });
    }
    const project = projectResult.project;

    const projectLat = toNumber(project.latitude);
    const projectLng = toNumber(project.longitude);
    if (projectLat == null || projectLng == null) {
      return res.status(400).json({ message: "Project location is not configured" });
    }

    const allowedMeters = project.project_code === "PRJ-GPS-TEST"
      ? 500000
      : (toNumber(project.gps_radius_meters) || MAX_DISTANCE_METERS);
    const distance = haversineDistanceMeters(latitude, longitude, projectLat, projectLng);
    if (distance > allowedMeters) {
      return res.status(400).json({
        message: "Outside allowed GPS radius",
        distanceMeters: Number(distance.toFixed(2)),
        allowedMeters
      });
    }

    const faceVerification = await verifyFaceForUser(userId, incomingEmbedding, incomingSignature, faceLiveness);
    if (!faceVerification.ok) {
      return res.status(faceVerification.code).json(
        faceVerification.detail ? { message: faceVerification.message, ...faceVerification.detail } : { message: faceVerification.message }
      );
    }
    const { matchResult, signatureMatch, livenessResult } = faceVerification;

    const activeLog = await pool.query(
      "SELECT id FROM attendance_logs WHERE user_id = $1 AND project_id = $2 AND check_out_time IS NULL",
      [userId, projectId]
    );
    if (activeLog.rowCount > 0) {
      return res.status(400).json({ message: "Already checked in and not checked out" });
    }

    const insertResult = await pool.query(
      `INSERT INTO attendance_logs
      (user_id, project_id, check_in_time, check_in_latitude, check_in_longitude, face_score, face_mode, liveness_score, attendance_status, is_within_geofence_in, gps_distance_in_m, captured_device)
      VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        userId,
        projectId,
        latitude,
        longitude,
        matchResult.score,
        matchResult.mode,
        livenessResult.score || null,
        isDayOffOrLeave ? "PENDING_OT_APPROVAL" : "OPEN",
        true,
        Number(distance.toFixed(2)),
        String(req.body.device || "MOBILE_WEB").slice(0, 80)
      ]
    );

    if (isDayOffOrLeave) {
      await pool.query(
        "UPDATE attendance_logs SET note = $1 WHERE id = $2",
        [`Auto OT check-in pending PM approval. Reason: ${otReason}`, insertResult.rows[0].id]
      );
    }

    await writeDataLog({
      action: "check-in",
      collection: "attendance",
      recordId: String(insertResult.rows[0].id),
      username: req.user.email,
      metadata: {
        projectId,
        distanceMeters: Number(distance.toFixed(2)),
        allowedMeters,
        score: Number(matchResult.score.toFixed(4)),
        signatureScore: Number(signatureMatch.score.toFixed(4)),
        mode: matchResult.mode,
        livenessScore: Number((livenessResult.score || 0).toFixed(4)),
        dayOffOtFlow: isDayOffOrLeave ? { pendingApproval: true, reason: otReason } : undefined
      }
    });

    return res.status(201).json({
      message: isDayOffOrLeave ? "Check-in successful. Pending OT approval from PM." : "Check-in successful",
      distanceMeters: Number(distance.toFixed(2)),
      data: insertResult.rows[0]
    });
  } catch (error) {
    return res.status(500).json({ message: "Vào ca failed", error: error.message });
  }
});

app.post("/attendance/check-out", authenticate, async (req, res) => {
  try {
    const userId = req.user.sub;
    const projectId = toNumber(req.body.projectId);
    const latitude = toNumber(req.body.latitude);
    const longitude = toNumber(req.body.longitude);
    const incomingEmbedding = req.body.faceEmbedding;
    const incomingSignature = req.body.faceSignature;
    const faceLiveness = req.body.faceLiveness;

    if (projectId == null || latitude == null || longitude == null) {
      return res.status(400).json({ message: "projectId, latitude, longitude are required" });
    }
    if (!Array.isArray(incomingEmbedding)) {
      return res.status(400).json({ message: "faceEmbedding is required for check-out" });
    }
    const todaySchedule = await getTodaySchedule(userId);
    if (!todaySchedule) {
      return res.status(403).json({ message: "No schedule found for today. Please contact your project manager." });
    }
    const scheduleStatus = String(todaySchedule.status || "").toUpperCase();
    const isDayOffOrLeave = scheduleStatus === "DAY_OFF" || scheduleStatus === "LEAVE";
    if (isDayOffOrLeave) {
      const activeLogOnDayOff = await pool.query(
        "SELECT id FROM attendance_logs WHERE user_id = $1 AND project_id = $2 AND check_out_time IS NULL",
        [userId, projectId]
      );
      if (activeLogOnDayOff.rowCount === 0) {
        return res.status(403).json({ message: "Today is your day off/leave. No active OT check-in found." });
      }
    }
    if (Number(todaySchedule.project_id) !== Number(projectId)) {
      return res.status(403).json({ message: "Project does not match your assigned schedule for today." });
    }

    const faceVerification = await verifyFaceForUser(userId, incomingEmbedding, incomingSignature, faceLiveness);
    if (!faceVerification.ok) {
      return res.status(faceVerification.code).json(
        faceVerification.detail ? { message: faceVerification.message, ...faceVerification.detail } : { message: faceVerification.message }
      );
    }
    const { matchResult, signatureMatch, livenessResult } = faceVerification;

    const projectResult = await resolveProject(projectId, latitude, longitude);
    if (projectResult.error) {
      return res.status(projectResult.error.code).json({ message: projectResult.error.message });
    }
    const project = projectResult.project;
    const projectLat = toNumber(project.latitude);
    const projectLng = toNumber(project.longitude);
    if (projectLat == null || projectLng == null) {
      return res.status(400).json({ message: "Project location is not configured" });
    }
    const allowedMeters = project.project_code === "PRJ-GPS-TEST"
      ? 500000
      : (toNumber(project.gps_radius_meters) || MAX_DISTANCE_METERS);
    const distance = haversineDistanceMeters(latitude, longitude, projectLat, projectLng);
    const isWithinGeofenceOut = distance <= allowedMeters;
    if (!isWithinGeofenceOut) {
      return res.status(400).json({
        message: "Outside allowed GPS radius",
        distanceMeters: Number(distance.toFixed(2)),
        allowedMeters
      });
    }

    const updateResult = await pool.query(
      `UPDATE attendance_logs
       SET check_out_time = NOW(),
           check_out_latitude = $1,
           check_out_longitude = $2,
           is_within_geofence_out = $3,
           gps_distance_out_m = $4,
           attendance_status = 'COMPLETED',
           face_mode = COALESCE(face_mode, $5),
           liveness_score = COALESCE(liveness_score, $6)
       WHERE user_id = $7 AND project_id = $8 AND check_out_time IS NULL
       RETURNING *`,
      [latitude, longitude, isWithinGeofenceOut, Number(distance.toFixed(2)), matchResult.mode, livenessResult.score || null, userId, projectId]
    );

    if (updateResult.rowCount === 0) {
      return res.status(404).json({ message: "No active check-in found" });
    }

    await writeDataLog({
      action: "check-out",
      collection: "attendance",
      recordId: String(updateResult.rows[0].id),
      username: req.user.email,
      metadata: {
        projectId,
        score: Number(matchResult.score.toFixed(4)),
        signatureScore: Number(signatureMatch.score.toFixed(4)),
        mode: matchResult.mode,
        livenessScore: Number((livenessResult.score || 0).toFixed(4))
      }
    });

    return res.json({ message: "Check-out successful", data: updateResult.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: "Ra ca failed", error: error.message });
  }
});

app.get("/attendance/history", authenticate, async (req, res) => {
  try {
    const filterUserId = toNumber(req.query.userId);
    const filterProjectId = toNumber(req.query.projectId);
    const filterDate = req.query.date ? String(req.query.date).trim() : "";

    const where = [];
    const values = [];

    if (req.user.role === "EMPLOYEE") {
      values.push(req.user.sub);
      where.push(`a.user_id = $${values.length}`);
    } else if (filterUserId != null) {
      values.push(filterUserId);
      where.push(`a.user_id = $${values.length}`);
    }

    if (filterDate) {
      values.push(filterDate);
      where.push(`DATE(a.check_in_time) = $${values.length}`);
    }

    if (filterProjectId != null) {
      values.push(filterProjectId);
      where.push(`a.project_id = $${values.length}`);
    }

    const condition = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
    const query = `
      SELECT a.*,
             COALESCE(NULLIF(TRIM(CONCAT_WS(' ', u.last_name, u.first_name)), ''), u.full_name) AS full_name,
             u.employee_code,
             p.name AS project_name,
             t.working_day_value AS timesheet_working_day_value,
             t.ot_hours AS timesheet_ot_hours,
             t.timesheet_status AS timesheet_status,
             t.actual_hours AS timesheet_actual_hours
      FROM attendance_logs a
      JOIN users u ON a.user_id = u.id
      JOIN projects p ON a.project_id = p.id
      LEFT JOIN timesheets t ON t.attendance_log_id = a.id
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
        filteredByUserId: filterUserId,
        filteredByProjectId: filterProjectId,
        filteredByDate: filterDate || null
      }
    });

    return res.json(result.rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to load lịch sử chấm công", error: error.message });
  }
});

app.delete("/attendance/history/:id", authenticate, authorize("HR_MANAGER", "PROJECT_MANAGER"), async (req, res) => {
  try {
    const attendanceId = toNumber(req.params.id);
    if (attendanceId == null || attendanceId <= 0) {
      return res.status(400).json({ message: "Invalid attendance id" });
    }

    const result = await pool.query(
      `DELETE FROM attendance_logs
       WHERE id = $1
       RETURNING id, user_id, project_id, check_in_time, check_out_time`,
      [attendanceId]
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ message: "Attendance record not found" });
    }

    await writeDataLog({
      action: "delete",
      collection: "attendance",
      recordId: String(attendanceId),
      username: req.user.email,
      metadata: {
        userId: result.rows[0].user_id,
        projectId: result.rows[0].project_id
      }
    });

    return res.json({ message: "Attendance record deleted", data: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: "Failed to delete attendance record", error: error.message });
  }
});

app.put("/attendance/history/:id", authenticate, authorize("HR_MANAGER", "PROJECT_MANAGER"), async (req, res) => {
  try {
    const attendanceId = toNumber(req.params.id);
    if (attendanceId == null || attendanceId <= 0) {
      return res.status(400).json({ message: "Invalid attendance id" });
    }

    const target = await pool.query(
      `SELECT id, user_id, project_id, check_in_time, check_out_time
       FROM attendance_logs
       WHERE id = $1`,
      [attendanceId]
    );
    if (target.rowCount === 0) {
      return res.status(404).json({ message: "Attendance record not found" });
    }
    const current = target.rows[0];

    const hasProjectId = Object.prototype.hasOwnProperty.call(req.body, "projectId");
    const hasCheckInTime = Object.prototype.hasOwnProperty.call(req.body, "checkInTime");
    const hasCheckOutTime = Object.prototype.hasOwnProperty.call(req.body, "checkOutTime");
    if (!hasProjectId && !hasCheckInTime && !hasCheckOutTime) {
      return res.status(400).json({ message: "No update fields provided" });
    }

    let nextProjectId = current.project_id;
    if (hasProjectId) {
      const projectId = toNumber(req.body.projectId);
      if (projectId == null || projectId <= 0) {
        return res.status(400).json({ message: "projectId is invalid" });
      }
      const projectExists = await pool.query("SELECT id FROM projects WHERE id = $1", [projectId]);
      if (projectExists.rowCount === 0) {
        return res.status(404).json({ message: "Project not found" });
      }
      nextProjectId = projectId;
    }

    let nextCheckInTime = current.check_in_time;
    if (hasCheckInTime) {
      const parsed = parseTimestamp(req.body.checkInTime);
      if (!parsed) {
        return res.status(400).json({ message: "checkInTime is invalid" });
      }
      nextCheckInTime = parsed;
    }

    let nextCheckOutTime = current.check_out_time;
    if (hasCheckOutTime) {
      if (req.body.checkOutTime == null || String(req.body.checkOutTime).trim() === "") {
        nextCheckOutTime = null;
      } else {
        const parsed = parseTimestamp(req.body.checkOutTime);
        if (!parsed) {
          return res.status(400).json({ message: "checkOutTime is invalid" });
        }
        nextCheckOutTime = parsed;
      }
    }

    if (nextCheckInTime && nextCheckOutTime && new Date(nextCheckOutTime).getTime() < new Date(nextCheckInTime).getTime()) {
      return res.status(400).json({ message: "checkOutTime must be later than or equal to checkInTime" });
    }

    const attendanceStatus = nextCheckOutTime ? "COMPLETED" : "OPEN";
    const result = await pool.query(
      `UPDATE attendance_logs
       SET project_id = $1,
           check_in_time = $2,
           check_out_time = $3,
           attendance_status = $4
       WHERE id = $5
       RETURNING id, user_id, project_id, check_in_time, check_out_time, check_in_latitude, check_in_longitude, check_out_latitude, check_out_longitude, face_score, created_at`,
      [nextProjectId, nextCheckInTime, nextCheckOutTime, attendanceStatus, attendanceId]
    );
    await upsertTimesheetForAttendanceRow(result.rows[0]);

    await writeDataLog({
      action: "update",
      collection: "attendance",
      recordId: String(attendanceId),
      username: req.user.email,
      metadata: {
        before: {
          projectId: current.project_id,
          checkInTime: current.check_in_time,
          checkOutTime: current.check_out_time
        },
        after: {
          projectId: nextProjectId,
          checkInTime: nextCheckInTime,
          checkOutTime: nextCheckOutTime
        }
      }
    });

    return res.json({ message: "Attendance record updated", data: result.rows[0] });
  } catch (error) {
    return res.status(500).json({ message: "Failed to update attendance record", error: error.message });
  }
});
app.post("/attendance/location", authenticate, authorize("EMPLOYEE", "PROJECT_MANAGER", "HR_MANAGER"), async (req, res) => {
  try {
    const projectId = req.body.projectId == null ? null : toNumber(req.body.projectId);
    const latitude = toNumber(req.body.latitude);
    const longitude = toNumber(req.body.longitude);
    const source = String(req.body.source || "GPS").trim() || "GPS";
    const accuracyMeters = req.body.accuracyMeters == null ? null : toNumber(req.body.accuracyMeters);

    if (latitude == null || longitude == null) {
      return res.status(400).json({ message: "latitude và longitude is required" });
    }
    if (req.body.projectId != null && projectId == null) {
      return res.status(400).json({ message: "projectId is invalid" });
    }

    if (projectId != null) {
      const projectExists = await pool.query("SELECT id FROM projects WHERE id = $1", [projectId]);
      if (projectExists.rowCount === 0) {
        return res.status(404).json({ message: "Project not found" });
      }
    }

    const result = await pool.query(
      `INSERT INTO employee_locations (user_id, project_id, latitude, longitude, accuracy_meters, source)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [req.user.sub, projectId, latitude, longitude, accuracyMeters, source]
    );

    await writeDataLog({
      action: "create",
      collection: "employee-location",
      recordId: String(result.rows[0].id),
      username: req.user.email,
      metadata: { projectId }
    });

    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ message: "Failed to save location", error: error.message });
  }
});

app.get("/attendance/location/latest", authenticate, authorize("HR_MANAGER", "PROJECT_MANAGER"), async (req, res) => {
  try {
    const projectId = toNumber(req.query.projectId);
    const userId = toNumber(req.query.userId);
    const where = [];
    const values = [];

    if (projectId != null) {
      values.push(projectId);
      where.push(`el.project_id = $${values.length}`);
    }
    if (userId != null) {
      values.push(userId);
      where.push(`el.user_id = $${values.length}`);
    }

    const condition = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
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

app.get("/attendance/reports/attendance-summary", authenticate, authorize("HR_MANAGER", "PROJECT_MANAGER"), async (req, res) => {
  try {
    const from = req.query.from ? String(req.query.from).trim() : "";
    const to = req.query.to ? String(req.query.to).trim() : "";
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

    const condition = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
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
      metadata: {
        count: result.rows.length,
        from: from || null,
        to: to || null
      }
    });

    return res.json(result.rows);
  } catch (error) {
    return res.status(500).json({ message: "Failed to build báo cáo chấm công", error: error.message });
  }
});

app.get("/attendance/reports/hr-summary", authenticate, authorize("HR_MANAGER"), async (req, res) => {
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

ensureAttendanceSchema()
  .then(() => {
    setInterval(() => {
      markMissingCheckouts().catch((error) => {
        console.error("markMissingCheckouts failed:", error.message);
      });
    }, 5 * 60 * 1000);
    markMissingCheckouts().catch((error) => {
      console.error("markMissingCheckouts initial run failed:", error.message);
    });
    setInterval(() => {
      recomputeTimesheets().catch((error) => {
        console.error("recomputeTimesheets failed:", error.message);
      });
    }, 30 * 60 * 1000);
    recomputeTimesheets().catch((error) => {
      console.error("recomputeTimesheets initial run failed:", error.message);
    });
    app.listen(port, () => {
      console.log(`attendance-service listening on ${port}`);
    });
  })
  .catch((error) => {
    console.error("attendance-service startup failed:", error.message);
    process.exit(1);
  });

