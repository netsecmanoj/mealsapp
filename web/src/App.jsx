import { useEffect, useState } from "react";
import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { clearSession, getSession, getSystemTime, SESSION_EVENT } from "./lib/api.js";
import Login from "./pages/Login.jsx";
import Schedule from "./pages/Schedule.jsx";
import Calendar from "./pages/Calendar.jsx";
import Supervisor from "./pages/Supervisor.jsx";
import Report from "./pages/Report.jsx";
import Availability from "./pages/Availability.jsx";
import AdminUsers from "./pages/AdminUsers.jsx";
import AdminDefaults from "./pages/AdminDefaults.jsx";
import Kiosk from "./pages/Kiosk.jsx";
import Settings from "./pages/Settings.jsx";
import Requests from "./pages/Requests.jsx";
import AuditLog from "./pages/AuditLog.jsx";

function ProtectedRoute({ children, roles }) {
  const session = getSession();

  if (!session?.token) {
    return <Navigate to="/login" replace />;
  }

  if (roles && !roles.includes(session.user?.role)) {
    return <Navigate to="/schedule" replace />;
  }

  return children;
}

export default function App() {
  const [session, setSessionState] = useState(() => getSession());
  const [clockNow, setClockNow] = useState(null);
  const [clockZone, setClockZone] = useState("");
  useEffect(() => {
    const sync = () => setSessionState(getSession());
    window.addEventListener(SESSION_EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(SESSION_EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);
  useEffect(() => {
    if (!session?.token) {
      setClockNow(null);
      setClockZone("");
      return undefined;
    }
    let active = true;
    let timer;
    let skewMs = 0;
    const load = async () => {
      try {
        const data = await getSystemTime();
        if (!active) return;
        const serverNow = new Date(data.serverNow);
        skewMs = serverNow.getTime() - Date.now();
        setClockZone(data.timezone || "");
        const tick = () => setClockNow(new Date(Date.now() + skewMs));
        tick();
        timer = window.setInterval(tick, 1000);
      } catch {
        if (!active) return;
        setClockNow(null);
        setClockZone("");
      }
    };
    load();
    return () => {
      active = false;
      if (timer) window.clearInterval(timer);
    };
  }, [session?.token]);
  const role = session?.user?.role || "";
  const canReport = role === "SUPERVISOR" || role === "ADMIN" || role === "HR_ADMIN" || role === "SUPER_ADMIN";
  const canSupervisor = role === "SUPERVISOR" || role === "HR_ADMIN" || role === "SUPER_ADMIN";
  const canAdmin = role === "HR_ADMIN" || role === "SUPER_ADMIN";
  const canAudit = role === "HR_ADMIN" || role === "SUPER_ADMIN";
  const canKiosk = role === "GROUND_STAFF" || role === "SUPER_ADMIN";
  const canSettings = role === "SUPER_ADMIN";
  const navLinks = [
    { to: "/schedule", label: "Schedule", show: true },
    { to: "/calendar", label: "Calendar", show: true },
    { to: "/report", label: "Report", show: canReport },
    { to: "/supervisor", label: "Supervisor", show: canSupervisor },
    { to: "/availability", label: "Availability", show: canAdmin },
    { to: "/admin/users", label: "Users", show: canAdmin },
    { to: "/admin/defaults", label: "Defaults", show: canAdmin },
    { to: "/requests", label: "Requests", show: canAdmin },
    { to: "/audit", label: "Audit", show: canAudit },
    { to: "/kiosk", label: "Kiosk", show: canKiosk },
    { to: "/settings", label: "Settings", show: canSettings },
  ];
  const handleLogout = () => {
    clearSession();
    window.location.href = "/login";
  };

  const clockLabel =
    clockNow && clockZone
      ? `${new Intl.DateTimeFormat("en-US", {
          timeZone: clockZone,
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        }).format(clockNow)} (${clockZone})`
      : "";

  return (
    <>
      {session?.token ? (
        <nav className="top-nav">
          {navLinks
            .filter((link) => link.show)
            .map((link) => (
              <NavLink key={link.to} to={link.to}>
                {link.label}
              </NavLink>
            ))}
          {clockLabel ? <span className="nav-clock">{clockLabel}</span> : null}
          <span className="nav-role">Role: {role || "unknown"}</span>
          <button className="nav-logout" onClick={handleLogout}>
            Logout
          </button>
        </nav>
      ) : null}
      <Routes>
        <Route
          path="/login"
          element={session?.token ? <Navigate to="/schedule" replace /> : <Login />}
        />
        <Route
          path="/schedule"
          element={
            <ProtectedRoute>
              <Schedule />
            </ProtectedRoute>
          }
        />
        <Route
          path="/calendar"
          element={
            <ProtectedRoute>
              <Calendar />
            </ProtectedRoute>
          }
        />
        <Route
          path="/supervisor"
          element={
            <ProtectedRoute roles={["SUPERVISOR", "HR_ADMIN", "SUPER_ADMIN"]}>
              <Supervisor />
            </ProtectedRoute>
          }
        />
        <Route
          path="/report"
          element={
            <ProtectedRoute roles={["SUPERVISOR", "ADMIN", "HR_ADMIN", "SUPER_ADMIN"]}>
              <Report />
            </ProtectedRoute>
          }
        />
        <Route
          path="/availability"
          element={
            <ProtectedRoute roles={["HR_ADMIN", "SUPER_ADMIN"]}>
              <Availability />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/users"
          element={
            <ProtectedRoute roles={["HR_ADMIN", "SUPER_ADMIN"]}>
              <AdminUsers />
            </ProtectedRoute>
          }
        />
        <Route
          path="/admin/defaults"
          element={
            <ProtectedRoute roles={["HR_ADMIN", "SUPER_ADMIN"]}>
              <AdminDefaults />
            </ProtectedRoute>
          }
        />
        <Route
          path="/requests"
          element={
            <ProtectedRoute roles={["HR_ADMIN", "SUPER_ADMIN"]}>
              <Requests />
            </ProtectedRoute>
          }
        />
        <Route
          path="/audit"
          element={
            <ProtectedRoute roles={["HR_ADMIN", "SUPER_ADMIN"]}>
              <AuditLog />
            </ProtectedRoute>
          }
        />
        <Route
          path="/kiosk"
          element={
            <ProtectedRoute roles={["GROUND_STAFF", "SUPER_ADMIN"]}>
              <Kiosk />
            </ProtectedRoute>
          }
        />
        <Route
          path="/settings"
          element={
            <ProtectedRoute roles={["SUPER_ADMIN"]}>
              <Settings />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/schedule" replace />} />
      </Routes>
    </>
  );
}
