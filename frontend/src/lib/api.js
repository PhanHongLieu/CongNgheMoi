const API_BASE = "http://localhost:8080/api";

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
    const message = (data && data.message) || raw || "Request failed";
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


