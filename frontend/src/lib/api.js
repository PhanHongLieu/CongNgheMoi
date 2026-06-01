const API_BASE =
  import.meta.env.VITE_API_BASE ||
  (typeof window !== "undefined" ? `${window.location.protocol}//${window.location.hostname}:8080/api` : "http://localhost:8080/api");

function emitToast(type, message) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent("app:toast", {
      detail: { type, message }
    })
  );
}

function emitAuthInvalid(message) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent("app:auth-invalid", {
      detail: { message }
    })
  );
}

function normalizeApiErrorMessage(data, raw, response) {
  if (data && typeof data === "object" && data.message) {
    return data.message;
  }
  const text = String(raw || data || "").trim();
  if (text.startsWith("<!DOCTYPE") || text.startsWith("<html") || response.status === 502) {
    return `Service unavailable (${response.status}). Please check backend deployment logs.`;
  }
  return text || `Request failed (${response.status})`;
}

export async function apiRequest(path, token, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  const shouldToast = options.toast !== false && method !== "GET";

  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });

  const raw = await response.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = raw;
  }

  if (!response.ok) {
    const message = normalizeApiErrorMessage(data, raw, response);
    if (response.status === 401) {
      emitAuthInvalid(message);
    }
    if (shouldToast) {
      emitToast("error", message);
    }
    throw new Error(message);
  }

  if (shouldToast) {
    const successMessage = options.successMessage || (data && data.message) || "Operation completed successfully";
    emitToast("success", successMessage);
  }

  return data;
}

export { API_BASE };


