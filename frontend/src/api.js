const runtimeApiBase = window.__APP_CONFIG__?.VITE_API_URL;
const configuredApiBase = runtimeApiBase || import.meta.env.VITE_API_URL || "http://localhost:8000";
const API_BASE = /^https?:\/\//.test(configuredApiBase)
  ? configuredApiBase
  : `https://${configuredApiBase}`;

class ApiError extends Error {
  constructor(message, { status, payload, cause } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status ?? null;
    this.payload = payload ?? null;
    this.cause = cause;
  }
}

function toIsoIfPresent(value) {
  return value ? new Date(value).toISOString() : null;
}

async function request(path, options = {}, token) {
  const headers = {
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options.headers || {}),
  };
  if (options.body !== undefined && !(options.body instanceof FormData) && !("Content-Type" in headers)) {
    headers["Content-Type"] = "application/json";
  }
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...options,
      headers,
    });
  } catch (error) {
    throw new ApiError("Network request failed", { cause: error });
  }

  if (response.status === 204) {
    return null;
  }

  const contentType = response.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    if (!response.ok) {
      throw new ApiError(`Request failed with status ${response.status}`, { status: response.status });
    }
    return response;
  }

  const payload = await response.json();
  if (!response.ok) {
    throw new ApiError(payload.detail || `Request failed with status ${response.status}`, {
      status: response.status,
      payload,
    });
  }
  return payload;
}

export const api = {
  login: (username, password) =>
    request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  register: (username, password) =>
    request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  me: (token) => request("/api/auth/me", {}, token),
  listApplicationConfigs: (token) => request("/api/applications/config", {}, token),
  listApplications: (token) => request("/api/applications", {}, token),
  createApplication: (token, payload) =>
    request("/api/applications", { method: "POST", body: JSON.stringify(payload) }, token),
  updateApplication: (token, id, payload) =>
    request(`/api/applications/${id}`, { method: "PUT", body: JSON.stringify(payload) }, token),
  deleteApplication: (token, id) => request(`/api/applications/${id}`, { method: "DELETE" }, token),
  resetGlobalScore: (token, id) =>
    request(`/api/applications/${id}/reset-global-score`, { method: "POST" }, token),
  listTests: (token, applicationId) => request(`/api/applications/${applicationId}/tests`, {}, token),
  createTest: (token, applicationId, payload) =>
    request(`/api/applications/${applicationId}/tests`, { method: "POST", body: JSON.stringify(payload) }, token),
  updateTest: (token, id, payload) =>
    request(`/api/tests/${id}`, { method: "PUT", body: JSON.stringify(payload) }, token),
  deleteTest: (token, id) => request(`/api/tests/${id}`, { method: "DELETE" }, token),
  dashboard: (token, startAt, endAt) => {
    const params = new URLSearchParams();
    const startIso = toIsoIfPresent(startAt);
    const endIso = toIsoIfPresent(endAt);
    if (startIso) {
      params.set("start_at", startIso);
    }
    if (endIso) {
      params.set("end_at", endIso);
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request(`/api/dashboard${suffix}`, {}, token);
  },
  dashboardApplication: (token, applicationId, startAt, endAt) => {
    const params = new URLSearchParams();
    const startIso = toIsoIfPresent(startAt);
    const endIso = toIsoIfPresent(endAt);
    if (startIso) {
      params.set("start_at", startIso);
    }
    if (endIso) {
      params.set("end_at", endIso);
    }
    const suffix = params.toString() ? `?${params.toString()}` : "";
    return request(`/api/applications/${applicationId}/dashboard${suffix}`, {}, token);
  },
  results: (token, applicationId, limit = 100) =>
    request(`/api/applications/${applicationId}/results?limit=${limit}`, {}, token),
  history: (token, applicationId, windowHours, errorCode) => {
    const params = new URLSearchParams({ window_hours: String(windowHours) });
    if (errorCode) {
      params.set("error_code", errorCode);
    }
    return request(`/api/applications/${applicationId}/history?${params.toString()}`, {}, token);
  },
  historyRange: (token, applicationId, startAt, endAt, errorCode) => {
    const params = new URLSearchParams();
    const startIso = toIsoIfPresent(startAt);
    const endIso = toIsoIfPresent(endAt);
    if (startIso) {
      params.set("start_at", startIso);
    }
    if (endIso) {
      params.set("end_at", endIso);
    }
    if (errorCode) {
      params.set("error_code", errorCode);
    }
    return request(`/api/applications/${applicationId}/history?${params.toString()}`, {}, token);
  },
};
