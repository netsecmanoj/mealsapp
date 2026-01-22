const baseUrl = import.meta.env.VITE_API_URL;

export function getSession() {
  const raw = localStorage.getItem("session");
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function setSession(session) {
  localStorage.setItem("session", JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem("session");
}

async function apiFetch(path, options = {}) {
  const session = getSession();
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  if (session?.token) {
    headers.set("Authorization", `Bearer ${session.token}`);
  }

  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers,
  });

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

export async function getMyChoices(from, to) {
  return apiFetch(`/api/me/choices?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, {
    method: "GET",
  });
}

export async function setMyChoice(date, mealType, wantMeal) {
  return apiFetch("/api/me/choice", {
    method: "POST",
    body: JSON.stringify({ date, mealType, wantMeal }),
  });
}

export async function listUsers() {
  return apiFetch("/api/users", { method: "GET" });
}

export async function setStaffChoice(employeeId, date, mealType, wantMeal) {
  return apiFetch("/api/staff/choice", {
    method: "POST",
    body: JSON.stringify({ employeeId, date, mealType, wantMeal }),
  });
}

export async function getDailyReport(date) {
  return apiFetch(`/api/reports/daily?date=${encodeURIComponent(date)}`, {
    method: "GET",
  });
}

export { apiFetch };
