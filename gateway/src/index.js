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
  if (explicitUrl) return explicitUrl;

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
      pathRewrite: (incomingPath) => `${serviceBasePath}${incomingPath}`
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
});
