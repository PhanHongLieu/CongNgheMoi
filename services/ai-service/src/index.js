require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const jwt = require("jsonwebtoken");
const { Pool } = require("pg");

const app = express();
const port = Number(process.env.PORT || process.env.AI_SERVICE_PORT || 3007);
const ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || "change_access_secret";
const TOKEN_ISSUER = process.env.TOKEN_ISSUER || "mdp-system";
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const AI_MODEL = process.env.AI_MODEL || "gpt-4o-mini";
const AI_PROVIDER = String(process.env.AI_PROVIDER || "openai").toLowerCase();

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

app.use(helmet());
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.get("/health", (req, res) => {
  res.json({ service: "ai-service", status: "ok" });
});

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

async function safeQuery(name, sql, params = []) {
  try {
    const { rows } = await pool.query(sql, params);
    return { name, rows };
  } catch (error) {
    return { name, error: error.message, rows: [] };
  }
}

function normalizeMessages(messages) {
  if (!Array.isArray(messages)) {
    return [];
  }
  return messages
    .slice(-8)
    .map((item) => ({
      role: item?.role === "assistant" ? "assistant" : "user",
      content: String(item?.content || "").slice(0, 1200)
    }))
    .filter((item) => item.content.trim());
}

function contextToText(context) {
  return context
    .map((section) => {
      if (section.error) {
        return `${section.name}: unavailable (${section.error})`;
      }
      return `${section.name}: ${JSON.stringify(section.rows).slice(0, 5000)}`;
    })
    .join("\n");
}

async function buildRoleContext(user) {
  const role = String(user.role || "").toUpperCase();
  const userId = Number(user.sub);
  const base = [
    safeQuery(
      "current_user",
      `SELECT u.id, u.employee_code, u.full_name, u.email, u.phone, u.status, u.job_title, u.trade_code,
              a.role, a.account_status
       FROM users u
       LEFT JOIN accounts a ON a.user_id = u.id
       WHERE u.id = $1`,
      [userId]
    )
  ];

  if (role === "EMPLOYEE") {
    return Promise.all([
      ...base,
      safeQuery(
        "my_assignments",
        `SELECT p.project_code, p.name AS project_name, pa.assignment_role, pa.assignment_status,
                pa.shift_code, pa.work_start, pa.work_end
         FROM project_assignments pa
         JOIN projects p ON p.id = pa.project_id
         WHERE pa.user_id = $1
         ORDER BY pa.created_at DESC
         LIMIT 8`,
        [userId]
      ),
      safeQuery(
        "my_attendance_recent",
        `SELECT p.project_code, p.name AS project_name, a.check_in_time, a.check_out_time, a.attendance_status
         FROM attendance_logs a
         LEFT JOIN projects p ON p.id = a.project_id
         WHERE a.user_id = $1
         ORDER BY a.created_at DESC
         LIMIT 10`,
        [userId]
      ),
      safeQuery(
        "my_requests_recent",
        `SELECT request_code, type, start_date, end_date, request_date, hours, status, reason
         FROM requests
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT 8`,
        [userId]
      )
    ]);
  }

  const managementContext = [
    ...base,
    safeQuery(
      "project_overview",
      `SELECT p.id, p.project_code, p.name, p.status, p.progress_percent, p.start_date, p.end_date,
              COUNT(DISTINCT pa.user_id) AS assigned_workers
       FROM projects p
       LEFT JOIN project_assignments pa ON pa.project_id = p.id AND pa.assignment_status = 'ACTIVE'
       GROUP BY p.id
       ORDER BY p.updated_at DESC
       LIMIT 8`
    ),
    safeQuery(
      "task_status_summary",
      `SELECT p.project_code, p.name AS project_name, ps.stage_name, i.status, COUNT(*) AS task_count
       FROM project_plan_boq_items i
       JOIN projects p ON p.id = i.project_id
       LEFT JOIN project_stages ps ON ps.id = i.stage_id
       WHERE i.item_type = 'PLAN'
       GROUP BY p.project_code, p.name, ps.stage_name, i.status
       ORDER BY p.project_code, ps.stage_name, i.status
       LIMIT 50`
    ),
    safeQuery(
      "material_risk_summary",
      `SELECT p.project_code, p.name AS project_name,
              COUNT(*) FILTER (WHERE m.received_qty > m.planned_qty) AS over_import_items,
              COUNT(*) FILTER (WHERE m.used_qty > m.planned_qty) AS over_usage_items,
              COUNT(*) FILTER (WHERE (m.received_qty - m.used_qty) <= 0) AS out_of_stock_items,
              COALESCE(SUM((m.received_qty - m.used_qty) * m.unit_cost), 0) AS stock_value
       FROM projects p
       LEFT JOIN project_material_logs m ON m.project_id = p.id
       GROUP BY p.project_code, p.name
       ORDER BY p.project_code
       LIMIT 20`
    ),
    safeQuery(
      "cost_summary",
      `SELECT p.project_code, p.name AS project_name, c.category, c.status, COALESCE(SUM(c.amount), 0) AS total_amount
       FROM project_cost_entries c
       JOIN projects p ON p.id = c.project_id
       GROUP BY p.project_code, p.name, c.category, c.status
       ORDER BY p.project_code, c.category, c.status
       LIMIT 50`
    ),
    safeQuery(
      "open_rfx_and_diary",
      `SELECT p.project_code, p.name AS project_name,
              COUNT(DISTINCT r.id) FILTER (WHERE COALESCE(r.status, '') NOT IN ('CLOSED', 'RESOLVED')) AS open_rfx,
              COUNT(DISTINCT d.id) AS diary_count
       FROM projects p
       LEFT JOIN project_rfx_records r ON r.project_id = p.id
       LEFT JOIN project_construction_diaries d ON d.project_id = p.id
       GROUP BY p.project_code, p.name
       ORDER BY p.project_code
       LIMIT 20`
    )
  ];

  if (role === "HR_MANAGER" || role === "ADMIN" || role === "SUPER_ADMIN") {
    managementContext.push(
      safeQuery(
        "hr_operations",
        `SELECT
           COUNT(*) FILTER (WHERE u.status = 'WORKING') AS active_employees,
           COUNT(*) FILTER (WHERE u.face_enrollment_status = 'PENDING') AS pending_face_enrollments,
           COUNT(*) FILTER (WHERE r.status = 'PENDING') AS pending_requests
         FROM users u
         LEFT JOIN requests r ON r.user_id = u.id`
      )
    );
  }

  return Promise.all(managementContext);
}

function fallbackAnswer(context, question) {
  const overview = context.find((item) => item.name === "project_overview")?.rows || [];
  const risks = context.find((item) => item.name === "material_risk_summary")?.rows || [];
  const pendingRisk = risks.find((item) => Number(item.out_of_stock_items || 0) > 0 || Number(item.over_usage_items || 0) > 0);
  const firstProject = overview[0];
  const lines = [];
  lines.push("AI is not fully configured yet because OPENAI_API_KEY is missing.");
  if (firstProject) {
    lines.push(`Current project snapshot: ${firstProject.project_code} - ${firstProject.name}, status ${firstProject.status}, progress ${firstProject.progress_percent || 0}%.`);
  }
  if (pendingRisk) {
    lines.push(`Material risk detected in ${pendingRisk.project_code}: ${pendingRisk.out_of_stock_items || 0} out-of-stock item(s), ${pendingRisk.over_usage_items || 0} over-usage item(s).`);
  }
  lines.push(`Your question was: "${question}". Add OPENAI_API_KEY and AI_MODEL on ai-service to enable full answers.`);
  return lines.join("\n");
}

async function askOpenAI({ question, messages, context, user }) {
  if (AI_PROVIDER !== "openai") {
    throw new Error(`Unsupported AI_PROVIDER: ${AI_PROVIDER}`);
  }
  if (!OPENAI_API_KEY) {
    return fallbackAnswer(context, question);
  }

  const systemPrompt = [
    "You are the MDP System AI assistant for a construction workforce and project management platform.",
    "Answer in the user's language. Be concise, practical, and based only on the provided system context.",
    "Respect role-based access. Do not claim access to data outside the context.",
    "If data is missing, say what is missing and which screen or report the user should check.",
    "For operations that change data, explain the steps; do not pretend you changed records."
  ].join(" ");

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: AI_MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "system",
          content: `Authenticated user: ${JSON.stringify({
            id: user.sub,
            role: user.role,
            email: user.email
          })}\nSystem context:\n${contextToText(context)}`
        },
        ...normalizeMessages(messages),
        { role: "user", content: question }
      ]
    })
  });

  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }
  if (!response.ok) {
    const message = data?.error?.message || data?.message || raw || `OpenAI request failed (${response.status})`;
    const code = data?.error?.code || data?.code || "";
    const type = data?.error?.type || data?.type || "";
    const quotaExceeded =
      response.status === 429 &&
      (String(code).includes("insufficient_quota") ||
        String(type).includes("insufficient_quota") ||
        String(message).toLowerCase().includes("quota"));
    if (quotaExceeded) {
      return [
        fallbackAnswer(context, question),
        "",
        "OpenAI API quota is exhausted for the configured key. Add billing/credits or replace OPENAI_API_KEY to enable full AI responses."
      ].join("\n");
    }
    throw new Error(message);
  }
  return data?.choices?.[0]?.message?.content || "I could not generate an answer.";
}

app.post("/ai/chat", authenticate, async (req, res) => {
  try {
    const question = String(req.body?.message || "").trim();
    if (!question) {
      return res.status(400).json({ message: "Message is required" });
    }
    if (question.length > 2000) {
      return res.status(400).json({ message: "Message is too long" });
    }
    const context = await buildRoleContext(req.user);
    const answer = await askOpenAI({
      question,
      messages: req.body?.messages,
      context,
      user: req.user
    });
    return res.json({
      message: "AI response generated",
      answer,
      model: OPENAI_API_KEY ? AI_MODEL : "not-configured",
      contextSections: context.map((item) => item.name)
    });
  } catch (error) {
    return res.status(500).json({ message: "AI chat failed", error: error.message });
  }
});

app.listen(port, () => {
  console.log(`ai-service listening on ${port}`);
});
