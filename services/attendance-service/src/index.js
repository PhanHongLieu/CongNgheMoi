require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();
const port = Number(process.env.ATTENDANCE_SERVICE_PORT || 3004);
const MAX_DISTANCE_METERS = Number(process.env.GPS_RADIUS_METERS || 100);
const EMBEDDING_PASS_THRESHOLD = Number(process.env.FACE_EMBEDDING_THRESHOLD || 0.88);
const SIGNATURE_PASS_THRESHOLD = Number(process.env.FACE_SIGNATURE_THRESHOLD || 0.76);
const LIVENESS_PASS_THRESHOLD = Number(process.env.FACE_LIVENESS_THRESHOLD || 0.6);
const FACE_IMPOSTOR_EMBEDDING_MARGIN = Number(process.env.FACE_IMPOSTOR_EMBEDDING_MARGIN || 0.015);
const FACE_IMPOSTOR_SIGNATURE_MARGIN = Number(process.env.FACE_IMPOSTOR_SIGNATURE_MARGIN || 0.03);

const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "change_access_secret";
const TOKEN_ISSUER = process.env.TOKEN_ISSUER || "mdp-system";

const pool = new Pool({
  host: process.env.POSTGRES_HOST || "localhost",
  port: Number(process.env.POSTGRES_PORT || 6543),
  database: process.env.POSTGRES_DB || "mdp_system",
  user: process.env.POSTGRES_USER || "mdp_user",
  password: process.env.POSTGRES_PASSWORD || "mdp_password"
});

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
  const raw = String(rawTemplate || "").trim();
  if (!raw || !raw.startsWith("{")) {
    return { embeddings: [], signatures: [] };
  }

  try {
    const parsed = JSON.parse(raw);
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
    const template = String(row?.face_template || "").trim();
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
  if (elapsedMs == null || elapsedMs < 1200 || elapsedMs > 18000) {
    return { passed: false, message: "Liveness challenge timing is invalid" };
  }
  const minFrames = type === "PASSIVE_FAST_V1" ? 4 : 6;
  if (observedFrames == null || observedFrames < minFrames) {
    return { passed: false, message: "Insufficient liveness frames" };
  }
  const minMovement = type === "PASSIVE_FAST_V1" ? 0.01 : 0.03;
  if (movementScore == null || movementScore < minMovement) {
    return { passed: false, message: "Head movement is insufficient" };
  }
  const minEyeDelta = type === "PASSIVE_FAST_V1" ? 0.01 : 0.02;
  const minHappy = type === "PASSIVE_FAST_V1" ? 0.3 : 0.5;
  if ((eyeOpenDelta == null || eyeOpenDelta < minEyeDelta) && (happyScoreMax == null || happyScoreMax < minHappy)) {
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

  const userResult = await pool.query("SELECT id, face_template FROM users WHERE id = $1", [userId]);
  if (userResult.rowCount === 0) {
    return { ok: false, code: 404, message: "User not found" };
  }

  const storedTemplate = String(userResult.rows[0].face_template || "").trim();
  if (!storedTemplate) {
    return { ok: false, code: 400, message: "Face template not registered. Please complete face enrollment first." };
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
    "SELECT face_template FROM users WHERE id <> $1 AND face_template IS NOT NULL AND TRIM(face_template) <> ''",
    [userId]
  );
  const impostorScores = findBestImpostorScores(impostorRows.rows || [], normalizedIncoming, normalizedSignature);
  if (
    impostorScores.bestEmbeddingScore >= embeddingMatch.score - FACE_IMPOSTOR_EMBEDDING_MARGIN ||
    impostorScores.bestSignatureScore >= signatureMatch.score - FACE_IMPOSTOR_SIGNATURE_MARGIN
  ) {
    return {
      ok: false,
      code: 401,
      message: "Face verification ambiguous. Please re-enroll with clearer samples."
    };
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

    const allowedMeters = project.project_code === "PRJ-GPS-TEST" ? 500000 : MAX_DISTANCE_METERS;
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
      (user_id, project_id, check_in_time, check_in_latitude, check_in_longitude, face_score)
      VALUES ($1, $2, NOW(), $3, $4, $5)
      RETURNING *`,
      [userId, projectId, latitude, longitude, matchResult.score]
    );

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
        livenessScore: Number((livenessResult.score || 0).toFixed(4))
      }
    });

    return res.status(201).json({
      message: "Check-in successful",
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

    const faceVerification = await verifyFaceForUser(userId, incomingEmbedding, incomingSignature, faceLiveness);
    if (!faceVerification.ok) {
      return res.status(faceVerification.code).json(
        faceVerification.detail ? { message: faceVerification.message, ...faceVerification.detail } : { message: faceVerification.message }
      );
    }
    const { matchResult, signatureMatch, livenessResult } = faceVerification;

    const updateResult = await pool.query(
      `UPDATE attendance_logs
       SET check_out_time = NOW(),
           check_out_latitude = $1,
           check_out_longitude = $2
       WHERE user_id = $3 AND project_id = $4 AND check_out_time IS NULL
       RETURNING *`,
      [latitude, longitude, userId, projectId]
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

    const result = await pool.query(
      `UPDATE attendance_logs
       SET project_id = $1,
           check_in_time = $2,
           check_out_time = $3
       WHERE id = $4
       RETURNING id, user_id, project_id, check_in_time, check_out_time, check_in_latitude, check_in_longitude, check_out_latitude, check_out_longitude, face_score, created_at`,
      [nextProjectId, nextCheckInTime, nextCheckOutTime, attendanceId]
    );

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
      `INSERT INTO employee_locations (user_id, project_id, latitude, longitude, source)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [req.user.sub, projectId, latitude, longitude, source]
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

app.listen(port, () => {
  console.log(`attendance-service listening on ${port}`);
});

