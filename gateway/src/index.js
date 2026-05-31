require("dotenv").config();
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const { createProxyMiddleware } = require("http-proxy-middleware");

const app = express();
const port = Number(process.env.GATEWAY_PORT || 8080);

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

proxyRoute("/api/auth", "http://auth-service:3001");
proxyRoute("/api/users", "http://user-service:3002");
proxyRoute("/api/salary", "http://user-service:3002");
proxyRoute("/api/projects", "http://project-service:3003");
proxyRoute("/api/attendance", "http://attendance-service:3004");
proxyRoute("/api/requests", "http://request-service:3006");
proxyRoute("/api/notifications", "http://notification-service:3005");

app.listen(port, () => {
  console.log(`api-gateway listening on ${port}`);
});
