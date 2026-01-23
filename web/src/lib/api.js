const rawBaseUrl = import.meta.env.VITE_API_BASE_URL ?? import.meta.env.VITE_API_URL ?? "/api";

function normalizeBaseUrl(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "/api";
  return trimmed.replace(/\/+$/, "");
}

function joinUrl(base, path) {
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  if (base.endsWith("/api") && normalizedPath.startsWith("/api")) {
    return `${base}${normalizedPath.slice(4)}`;
  }

  return `${base}${normalizedPath}`;
}

const baseUrl = normalizeBaseUrl(rawBaseUrl);
const sessionKey = "meals.session";
const legacySessionKey = "session";
export const SESSION_EVENT = "meals:session";

export function getSession() {
  const raw = localStorage.getItem(sessionKey);
  if (!raw) {
    const legacyRaw = localStorage.getItem(legacySessionKey);
    if (!legacyRaw) return null;
    try {
      const legacy = JSON.parse(legacyRaw);
      localStorage.setItem(sessionKey, JSON.stringify(legacy));
      localStorage.removeItem(legacySessionKey);
      return legacy;
    } catch {
      return null;
    }
  }
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setSession(session) {
  localStorage.setItem(sessionKey, JSON.stringify(session));
  localStorage.removeItem(legacySessionKey);
  window.dispatchEvent(new Event(SESSION_EVENT));
}

export function clearSession() {
  localStorage.removeItem(sessionKey);
  localStorage.removeItem(legacySessionKey);
  window.dispatchEvent(new Event(SESSION_EVENT));
}

async function apiFetch(path, options = {}) {
  const session = getSession();
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  if (session?.token) {
    headers.set("Authorization", `Bearer ${session.token}`);
  }

  const response = await fetch(joinUrl(baseUrl, path), {
    ...options,
    headers,
  });

  if (response.status === 401) {
    clearSession();
    window.location.href = "/login";
    throw new Error("Session expired. Please login again.");
  }

  if (!response.ok) {
    let message = "Request failed";
    try {
      const data = await response.json();
      if (data?.error) message = data.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }

  if (response.status === 204) return null;
  return response.json();
}

export async function login(employeeId, pin) {
  return apiFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ employeeId, pin }),
  });
}

export async function getEffectiveChoices(from, to) {
  return apiFetch(`/api/me/choices?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
    method: "GET",
  });
}

export async function getMyChoices(from, to) {
  return apiFetch(`/api/me/choices?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
    method: "GET",
  });
}

export async function getServiceDays(from, to) {
  return apiFetch(`/api/service-days?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
    method: "GET",
  });
}

export async function updateServiceDay(payload) {
  return apiFetch("/api/admin/service-day", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function applyServiceDayTemplate(from, to, templateName) {
  return apiFetch("/api/admin/service-days/apply-template", {
    method: "POST",
    body: JSON.stringify({ from, to, templateName }),
  });
}

export async function applyAvailabilityTemplate(payload) {
  return apiFetch("/api/admin/service-days/apply-template", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function setMyChoice(date, mealType, wantMeal) {
  return apiFetch("/api/me/choice", {
    method: "POST",
    body: JSON.stringify({ date, mealType, wantMeal }),
  });
}

export async function deleteChoice(date, mealType, reason) {
  return apiFetch("/api/choice", {
    method: "DELETE",
    body: JSON.stringify({ date, mealType, reason }),
  });
}

export async function createMealRequest(date, mealType, note) {
  return apiFetch("/api/meal-requests", {
    method: "POST",
    body: JSON.stringify({ date, mealType, note }),
  });
}

export async function cancelMealRequest(date, mealType) {
  return apiFetch("/api/meal-requests", {
    method: "DELETE",
    body: JSON.stringify({ date, mealType }),
  });
}

export async function listMyMealRequests(from, to) {
  return apiFetch(`/api/me/meal-requests?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
    method: "GET",
  });
}

export async function listUsers() {
  return apiFetch("/api/users", { method: "GET" });
}

export async function adminListUsers(query = "") {
  const q = query ? `?q=${encodeURIComponent(query)}` : "";
  return apiFetch(`/api/admin/users${q}`, { method: "GET" });
}

export async function adminCreateUser(payload) {
  return apiFetch("/api/admin/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function adminUpdateUser(id, payload) {
  return apiFetch(`/api/admin/users/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function adminResetPin(id, pin, reason) {
  return apiFetch(`/api/admin/users/${id}/reset-pin`, {
    method: "POST",
    body: JSON.stringify({ pin, reason }),
  });
}

export async function adminImportUsers(users, reason) {
  return apiFetch("/api/admin/users/import", {
    method: "POST",
    body: JSON.stringify({ users, reason }),
  });
}

export async function adminAssignSupervisor(employeeId, supervisorEmployeeId, reason) {
  return apiFetch("/api/admin/supervisor-assignments", {
    method: "PUT",
    body: JSON.stringify({ employeeId, supervisorEmployeeId, reason }),
  });
}

export async function adminListMealRequests(from, to, status) {
  const params = new URLSearchParams({ from, to });
  if (status) params.set("status", status);
  return apiFetch(`/api/admin/meal-requests?${params.toString()}`, {
    method: "GET",
  });
}

export async function adminDecideMealRequest(id, decision, reason) {
  return apiFetch("/api/admin/meal-requests/decide", {
    method: "POST",
    body: JSON.stringify({ id, decision, reason }),
  });
}

export async function adminApplyDefaults(payload) {
  return apiFetch("/api/admin/preferences/apply", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function searchVisitors(query) {
  const params = new URLSearchParams();
  if (query) params.set("q", query);
  return apiFetch(`/api/supervisor/visitors/search?${params.toString()}`, {
    method: "GET",
  });
}

export async function createVisitor(payload) {
  return apiFetch("/api/supervisor/visitors", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getVisitorMeals(visitorId, date) {
  const params = new URLSearchParams({ date });
  return apiFetch(`/api/supervisor/visitors/${visitorId}/meals?${params.toString()}`, {
    method: "GET",
  });
}

export async function setVisitorMeals(visitorId, payload) {
  return apiFetch(`/api/supervisor/visitors/${visitorId}/meals`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getSettings() {
  return apiFetch("/api/admin/settings", { method: "GET" });
}

export async function updateSettings(payload) {
  return apiFetch("/api/admin/settings", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function kioskCheckin(payload) {
  return apiFetch("/api/kiosk/checkin", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function kioskStatus(date, mealType) {
  const params = new URLSearchParams();
  if (date) params.set("date", date);
  params.set("mealType", mealType);
  return apiFetch(`/api/kiosk/status?${params.toString()}`, {
    method: "GET",
  });
}

export async function setStaffChoice(employeeId, date, mealType, wantMeal, reason) {
  return apiFetch("/api/staff/choice", {
    method: "POST",
    body: JSON.stringify({ employeeId, date, mealType, wantMeal, reason }),
  });
}

export async function getDailyReport(date) {
  const params = new URLSearchParams({ date });
  return apiFetch(`/api/reports/daily?${params.toString()}`, {
    method: "GET",
  });
}

export async function getDailyReportDetails(date, view, mealType) {
  const params = new URLSearchParams({ date, view });
  if (mealType) params.set("mealType", mealType);
  return apiFetch(`/api/reports/daily/details?${params.toString()}`, {
    method: "GET",
  });
}

export { apiFetch };
