import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  adminAssignSupervisor,
  adminCreateUser,
  adminGetMasterData,
  adminImportUsers,
  adminListUsers,
  adminResetPin,
  adminUpdateUser,
  getSession,
} from "../lib/api.js";

const roles = [
  "EMPLOYEE",
  "SUPERVISOR",
  "ADMIN",
  "HR_ADMIN",
  "SUPER_ADMIN",
  "GROUND_STAFF",
];

export default function AdminUsers() {
  const [query, setQuery] = useState("");
  const [users, setUsers] = useState([]);
  const [allUsers, setAllUsers] = useState([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [masterWarning, setMasterWarning] = useState("");
  const [masterData, setMasterData] = useState({
    departments: [],
    sites: [],
    usage: { departments: {}, sites: {} },
  });
  const [importJson, setImportJson] = useState("[]");
  const [newUser, setNewUser] = useState({
    employeeId: "",
    name: "",
    dept: "",
    site: "",
    role: "EMPLOYEE",
    supervisorEmployeeId: "",
    pin: "1234",
  });
  const [assignment, setAssignment] = useState({ employeeId: "", supervisorEmployeeId: "" });
  const role = getSession()?.user?.role;
  const isSuperAdmin = role === "SUPER_ADMIN";
  const canAssignSupervisor = role === "HR_ADMIN" || role === "SUPER_ADMIN";
  const canViewAdvanced = role === "ADMIN" || role === "HR_ADMIN" || role === "SUPER_ADMIN";
  const [showAdvanced, setShowAdvanced] = useState(false);
  const departments = masterData.departments || [];
  const sites = masterData.sites || [];
  const supervisorSource = allUsers.length ? allUsers : users;
  const getSupervisorsForSite = (site) =>
    supervisorSource.filter(
      (user) =>
        user.role === "SUPERVISOR" &&
        user.active &&
        user.site &&
        user.site === site
    );

  const getUnassigned = (list) =>
    list.find((item) => item.toLowerCase() === "unassigned") || "";
  const isUnassignedValue = (value) =>
    String(value ?? "").trim().toLowerCase() === "unassigned";

  const normalizeUsers = (list, master = masterData) => {
    const deptFallback = getUnassigned(master.departments);
    const siteFallback = getUnassigned(master.sites);
    return (list || []).map((user) => ({
      ...user,
      dept: user.dept ?? (deptFallback || ""),
      site: user.site ?? (siteFallback || ""),
      supervisorEmployeeId: user.supervisorEmployeeId ?? "",
    }));
  };

  const loadUsers = async (search = "", master = masterData) => {
    setError("");
    try {
      const data = await adminListUsers(search);
      const normalized = normalizeUsers(data, master);
      setUsers(normalized);
      if (!search) {
        setAllUsers(normalized);
      }
    } catch (err) {
      setError(err.message || "Failed");
    }
  };

  const loadMasterData = async () => {
    setError("");
    try {
      const data = await adminGetMasterData();
      const departments = data?.departments || [];
      const sites = data?.sites || [];
      const nextMaster = {
        departments,
        sites,
        usage: data?.usage || { departments: {}, sites: {} },
      };
      setMasterData(nextMaster);
      const warning =
        departments.length === 0 || sites.length === 0
          ? "Master Data not configured. Ask SUPER_ADMIN to configure Master Data."
          : "";
      setMasterWarning(warning);
      const deptDefault = getUnassigned(departments);
      const siteDefault = getUnassigned(sites);
      setNewUser((prev) => ({
        ...prev,
        dept: prev.dept || deptDefault || "",
        site: prev.site || siteDefault || "",
      }));
      return nextMaster;
    } catch (err) {
      setError(err.message || "Failed to load master data");
      return null;
    }
  };

  useEffect(() => {
    let active = true;
    const init = async () => {
      const master = await loadMasterData();
      if (!active) return;
      await loadUsers("", master || masterData);
    };
    init();
    return () => {
      active = false;
    };
  }, []);

  const handleCreate = async () => {
    setMessage("");
    setError("");
    if (newUser.role === "GROUND_STAFF") {
      if (isUnassignedValue(newUser.site)) {
        setError("Ground staff must have a site");
        return;
      }
      if (!newUser.supervisorEmployeeId) {
        setError("Supervisor is required for ground staff");
        return;
      }
    }
    try {
      await adminCreateUser({
        employeeId: newUser.employeeId,
        name: newUser.name,
        dept: newUser.dept || undefined,
        site: newUser.site || undefined,
        role: newUser.role,
        supervisorEmployeeId: newUser.supervisorEmployeeId || undefined,
        pin: newUser.pin,
      });
      setMessage("User created");
      loadUsers(query);
    } catch (err) {
      setError(err.message || "Failed");
    }
  };

  const handleUpdate = async (user) => {
    setMessage("");
    setError("");
    if (user.role === "GROUND_STAFF") {
      if (isUnassignedValue(user.site)) {
        setError("Ground staff must have a site");
        return;
      }
      if (!user.supervisorEmployeeId) {
        setError("Supervisor is required for ground staff");
        return;
      }
    }
    try {
      await adminUpdateUser(user.id, {
        name: user.name,
        dept: user.dept,
        site: user.site,
        role: user.role,
        active: user.active,
        supervisorEmployeeId: user.supervisorEmployeeId || null,
      });
      setMessage("User updated");
      loadUsers(query);
    } catch (err) {
      setError(err.message || "Failed");
    }
  };

  const handleResetPin = async (user) => {
    const pin = prompt("New PIN?");
    if (!pin) return;
    setMessage("");
    setError("");
    try {
      await adminResetPin(user.id, pin);
      setMessage("PIN reset");
    } catch (err) {
      setError(err.message || "Failed");
    }
  };

  const handleImport = async () => {
    setMessage("");
    setError("");
    try {
      const usersPayload = JSON.parse(importJson);
      await adminImportUsers(usersPayload);
      setMessage("Imported");
      loadUsers(query);
    } catch (err) {
      setError(err.message || "Failed");
    }
  };

  const handleAssign = async () => {
    setMessage("");
    setError("");
    try {
      await adminAssignSupervisor(
        assignment.employeeId,
        assignment.supervisorEmployeeId || null
      );
      setMessage("Supervisor assignment saved");
    } catch (err) {
      setError(err.message || "Failed");
    }
  };

  return (
    <div className="app">
      <div className="card">
        <h2>User Admin</h2>
        <div className="field">
          <label htmlFor="search">Search</label>
          <input
            id="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search by name, dept, employeeId"
          />
        </div>
        <div className="list-controls">
          <button className="button" onClick={() => loadUsers(query)}>
            Search
          </button>
          {isSuperAdmin ? (
            <Link className="button secondary" to="/master-data">
              Manage Master Data
            </Link>
          ) : null}
        </div>
      </div>

      {masterWarning ? (
        <div className="card">
          <div className="message error">{masterWarning}</div>
        </div>
      ) : null}

      <div className="card">
        <h2>Create User</h2>
        <div className="field">
          <label>Employee ID</label>
          <input
            value={newUser.employeeId}
            onChange={(event) => setNewUser({ ...newUser, employeeId: event.target.value })}
          />
        </div>
        <div className="field">
          <label>Name</label>
          <input
            value={newUser.name}
            onChange={(event) => setNewUser({ ...newUser, name: event.target.value })}
          />
        </div>
        <div className="field">
          <label>Dept</label>
          <select
            value={newUser.dept}
            onChange={(event) => setNewUser({ ...newUser, dept: event.target.value })}
            disabled={departments.length === 0}
          >
            {departments.length === 0 ? (
              <option value="">No departments</option>
            ) : (
              departments.map((dept) => (
                <option key={dept} value={dept}>
                  {dept}
                </option>
              ))
            )}
          </select>
        </div>
        <div className="field">
          <label>Site</label>
          <select
            value={newUser.site}
            onChange={(event) =>
              setNewUser((prev) => ({
                ...prev,
                site: event.target.value,
                supervisorEmployeeId: prev.role === "GROUND_STAFF" ? "" : prev.supervisorEmployeeId,
              }))
            }
            disabled={sites.length === 0}
          >
            {sites.length === 0 ? (
              <option value="">No sites</option>
            ) : (
              sites.map((site) => (
                <option key={site} value={site}>
                  {site}
                </option>
              ))
            )}
          </select>
        </div>
        <div className="field">
          <label>Role</label>
          <select
            value={newUser.role}
            onChange={(event) =>
              setNewUser((prev) => ({
                ...prev,
                role: event.target.value,
                supervisorEmployeeId:
                  event.target.value === "GROUND_STAFF" ? "" : prev.supervisorEmployeeId,
              }))
            }
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </div>
        {newUser.role === "GROUND_STAFF" ? (
          <div className="field">
            <label>Supervisor</label>
            <select
              value={newUser.supervisorEmployeeId}
              onChange={(event) =>
                setNewUser((prev) => ({ ...prev, supervisorEmployeeId: event.target.value }))
              }
              disabled={isUnassignedValue(newUser.site)}
            >
              <option value="">Select supervisor</option>
              {getSupervisorsForSite(newUser.site).map((user) => (
                <option key={user.employeeId} value={user.employeeId}>
                  {user.name} ({user.employeeId})
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div className="field">
          <label>PIN</label>
          <input
            value={newUser.pin}
            onChange={(event) => setNewUser({ ...newUser, pin: event.target.value })}
          />
        </div>
        <button className="button" onClick={handleCreate}>
          Create
        </button>
      </div>

      {canViewAdvanced ? (
        <div className="card">
          <div className="row">
            <div className="row-left">
              <div className="row-title">Advanced: Transfer/Reassign Supervisor (Admin only)</div>
            </div>
            <div className="list-controls">
              <button className="button secondary" onClick={() => setShowAdvanced((prev) => !prev)}>
                {showAdvanced ? "Hide" : "Show"}
              </button>
            </div>
          </div>
          {showAdvanced ? (
            canAssignSupervisor ? (
              <>
                <div className="field">
                  <label>Employee ID</label>
                  <input
                    value={assignment.employeeId}
                    onChange={(event) =>
                      setAssignment({ ...assignment, employeeId: event.target.value })
                    }
                  />
                </div>
                <div className="field">
                  <label>Supervisor Employee ID (blank to clear)</label>
                  <input
                    value={assignment.supervisorEmployeeId}
                    onChange={(event) =>
                      setAssignment({ ...assignment, supervisorEmployeeId: event.target.value })
                    }
                  />
                </div>
                <button className="button" onClick={handleAssign}>
                  Save assignment
                </button>
              </>
            ) : (
              <div className="message muted">Only HR_ADMIN or SUPER_ADMIN can reassign supervisors.</div>
            )
          ) : null}
        </div>
      ) : null}

      <div className="card">
        <h2>Import Users (JSON)</h2>
        <div className="field">
          <label>JSON Array</label>
          <textarea
            className="textarea"
            value={importJson}
            onChange={(event) => setImportJson(event.target.value)}
            rows={6}
          />
        </div>
        <button className="button" onClick={handleImport}>
          Import
        </button>
      </div>

      <div className="card">
        <h2>User List</h2>
        <div className="list">
          {users.map((user) => (
            <div className="list-row" key={user.id}>
              <div className="list-main">
                <div className="row-title">
                  <input
                    value={user.name}
                    onChange={(event) =>
                      setUsers((prev) =>
                        prev.map((item) =>
                          item.id === user.id ? { ...item, name: event.target.value } : item
                        )
                      )
                    }
                  />
                </div>
                <div className="row-status">{user.employeeId}</div>
                <div className="row-status">
                  <select
                    value={user.dept || ""}
                    onChange={(event) =>
                      setUsers((prev) =>
                        prev.map((item) =>
                          item.id === user.id ? { ...item, dept: event.target.value } : item
                        )
                      )
                    }
                    disabled={departments.length === 0}
                  >
                    {departments.length === 0 ? (
                      <option value="">No departments</option>
                    ) : (
                      departments.map((dept) => (
                        <option key={dept} value={dept}>
                          {dept}
                        </option>
                      ))
                    )}
                  </select>
                </div>
                <div className="row-status">
                  <select
                    value={user.site || ""}
                    onChange={(event) =>
                      setUsers((prev) =>
                        prev.map((item) =>
                          item.id === user.id
                            ? {
                                ...item,
                                site: event.target.value,
                                supervisorEmployeeId:
                                  item.role === "GROUND_STAFF" ? "" : item.supervisorEmployeeId,
                              }
                            : item
                        )
                      )
                    }
                    disabled={sites.length === 0}
                  >
                    {sites.length === 0 ? (
                      <option value="">No sites</option>
                    ) : (
                      sites.map((site) => (
                        <option key={site} value={site}>
                          {site}
                        </option>
                      ))
                    )}
                  </select>
                </div>
              </div>
              <div className="list-controls">
                {user.role === "GROUND_STAFF" ? (
                  <select
                    value={user.supervisorEmployeeId || ""}
                    onChange={(event) =>
                      setUsers((prev) =>
                        prev.map((item) =>
                          item.id === user.id
                            ? { ...item, supervisorEmployeeId: event.target.value }
                            : item
                        )
                      )
                    }
                    disabled={isUnassignedValue(user.site)}
                  >
                    <option value="">Select supervisor</option>
                    {getSupervisorsForSite(user.site).map((supervisor) => (
                      <option key={supervisor.employeeId} value={supervisor.employeeId}>
                        {supervisor.name} ({supervisor.employeeId})
                      </option>
                    ))}
                  </select>
                ) : null}
                <select
                  value={user.role}
                  onChange={(event) =>
                    setUsers((prev) =>
                      prev.map((item) =>
                        item.id === user.id
                          ? {
                              ...item,
                              role: event.target.value,
                              supervisorEmployeeId:
                                event.target.value === "GROUND_STAFF" ? "" : item.supervisorEmployeeId,
                            }
                          : item
                      )
                    )
                  }
                >
                  {roles.map((role) => (
                    <option key={role} value={role}>
                      {role}
                    </option>
                  ))}
                </select>
                <label className="toggle">
                  <input
                    type="checkbox"
                    checked={user.active}
                    onChange={(event) =>
                      setUsers((prev) =>
                        prev.map((item) =>
                          item.id === user.id ? { ...item, active: event.target.checked } : item
                        )
                      )
                    }
                  />
                  Active
                </label>
                <button className="button secondary" onClick={() => handleUpdate(user)}>
                  Save
                </button>
                <button className="button secondary" onClick={() => handleResetPin(user)}>
                  Reset PIN
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {message ? <div className="message success">{message}</div> : null}
      {error ? <div className="message error">{error}</div> : null}
    </div>
  );
}
