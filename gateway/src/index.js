require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();
const port = Number(process.env.PORT || process.env.GATEWAY_PORT || 8080);

app.use(helmet());
app.use(cors());
const MAX_BODY_SIZE_BYTES = 15 * 1024 * 1024;
const KEEP_ALIVE_ENABLED = String(process.env.KEEP_ALIVE_ENABLED || "true").toLowerCase() !== "false";
const KEEP_ALIVE_INTERVAL_MS = Number(process.env.KEEP_ALIVE_INTERVAL_MS || 8 * 60 * 1000);
app.use((req, res, next) => {
  const lengthHeader = req.headers["content-length"];
  if (!lengthHeader) {
    return next();
  }
  const bodySize = Number(lengthHeader);
  if (Number.isFinite(bodySize) && bodySize > MAX_BODY_SIZE_BYTES) {
    return res.status(413).json({ message: "Payload too large" });
  }
  return next();
});

app.get("/health", (req, res) => {
  res.json({ service: "api-gateway", status: "ok" });
});

function serviceTarget(key, fallbackHost, fallbackPort) {
  const explicitUrl = process.env[`${key}_URL`];
  if (explicitUrl) return explicitUrl.replace(/\/+$/, "");

  const host = process.env[`${key}_HOST`] || fallbackHost;
  const servicePort = process.env[`${key}_PORT`] || fallbackPort;
  const protocol = process.env[`${key}_PROTOCOL`] || "http";
  return `${protocol}://${host}:${servicePort}`;
}

function proxyRoute(path, target) {
  const serviceBasePath = path.replace("/api", "");
  app.use(
    path,
    createProxyMiddleware({
      target,
      changeOrigin: true,
      proxyTimeout: 30000,
      timeout: 30000,
      pathRewrite: (incomingPath) => `${serviceBasePath}${incomingPath}`
      ,
      on: {
        error: (error, req, res) => {
          console.error(`[proxy-error] ${req.method} ${path}${req.url} -> ${target}: ${error.message}`);
          if (!res.headersSent) {
            res.status(502).json({
              message: "Gateway could not reach upstream service",
              upstream: target,
              route: path,
              error: error.message
            });
          }
        }
      }
    })
  );
}

const authService = serviceTarget("AUTH_SERVICE", "auth-service", 3001);
const userService = serviceTarget("USER_SERVICE", "user-service", 3002);
const projectService = serviceTarget("PROJECT_SERVICE", "project-service", 3003);
const attendanceService = serviceTarget("ATTENDANCE_SERVICE", "attendance-service", 3004);
const notificationService = serviceTarget("NOTIFICATION_SERVICE", "notification-service", 3005);
const requestService = serviceTarget("REQUEST_SERVICE", "request-service", 3006);
const aiService = serviceTarget("AI_SERVICE", "ai-service", 3007);

function upstreamMap() {
  return {
    authService,
    userService,
    projectService,
    attendanceService,
    notificationService,
    requestService,
    aiService
  };
}

async function checkUpstream(name, target, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${target}/health`, { signal: controller.signal });
    const raw = await response.text();
    let body = raw;
    try {
      body = raw ? JSON.parse(raw) : null;
    } catch {
      body = raw.slice(0, 500);
    }
    return {
      name,
      target,
      ok: response.ok,
      status: response.status,
      body
    };
  } catch (error) {
    return {
      name,
      target,
      ok: false,
      status: null,
      error: error.name === "AbortError" ? "Health check timed out" : error.message
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkAllUpstreams(timeoutMs = 12000) {
  return Promise.all(
    Object.entries(upstreamMap()).map(([name, target]) => checkUpstream(name, target, timeoutMs))
  );
}

app.get("/health/upstreams", (req, res) => {
  res.json({
    service: "api-gateway",
    upstreams: upstreamMap()
  });
});

app.get("/health/upstreams/check", async (req, res) => {
  const results = await checkAllUpstreams();

  res.json({
    service: "api-gateway",
    ok: results.every((item) => item.ok),
    results
  });
});

app.get("/health/warmup", async (req, res) => {
  const results = await checkAllUpstreams(20000);
  res.json({
    service: "api-gateway",
    warmedAt: new Date().toISOString(),
    ok: results.every((item) => item.ok),
    results
  });
});

proxyRoute("/api/auth", authService);
proxyRoute("/api/audit", userService);
proxyRoute("/api/system", userService);
proxyRoute("/api/users", userService);
proxyRoute("/api/salary", userService);
proxyRoute("/api/projects", projectService);
proxyRoute("/api/attendance", attendanceService);
proxyRoute("/api/requests", requestService);
proxyRoute("/api/notifications", notificationService);
proxyRoute("/api/ai", aiService);

app.listen(port, () => {
  console.log(`api-gateway listening on ${port}`);
  if (KEEP_ALIVE_ENABLED && Number.isFinite(KEEP_ALIVE_INTERVAL_MS) && KEEP_ALIVE_INTERVAL_MS >= 60000) {
    setInterval(() => {
      checkAllUpstreams(20000)
        .then((results) => {
          const failed = results.filter((item) => !item.ok).map((item) => `${item.name}:${item.status || item.error}`);
          if (failed.length > 0) {
            console.warn(`[keep-alive] upstream issues: ${failed.join(", ")}`);
          } else {
            console.log("[keep-alive] upstreams warm");
          }
        })
        .catch((error) => console.warn(`[keep-alive] failed: ${error.message}`));
    }, KEEP_ALIVE_INTERVAL_MS);
  }
});
