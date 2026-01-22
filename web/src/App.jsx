import { NavLink, Navigate, Route, Routes } from "react-router-dom";
import { getSession } from "./lib/api.js";
import Login from "./pages/Login.jsx";
import Schedule from "./pages/Schedule.jsx";
import Supervisor from "./pages/Supervisor.jsx";
import Report from "./pages/Report.jsx";

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
  const session = getSession();
  const role = session?.user?.role;
  const canManage = role === "SUPERVISOR" || role === "ADMIN";

  return (
    <>
      {session?.token ? (
        <nav className="top-nav">
          <NavLink to="/schedule">Schedule</NavLink>
          <NavLink to="/report">Report</NavLink>
          {canManage ? <NavLink to="/supervisor">Supervisor</NavLink> : null}
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
          path="/supervisor"
          element={
            <ProtectedRoute roles={["SUPERVISOR", "ADMIN"]}>
              <Supervisor />
            </ProtectedRoute>
          }
        />
        <Route
          path="/report"
          element={
            <ProtectedRoute roles={["SUPERVISOR", "ADMIN"]}>
              <Report />
            </ProtectedRoute>
          }
        />
        <Route path="*" element={<Navigate to="/schedule" replace />} />
      </Routes>
    </>
  );
}
