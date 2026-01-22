import { useEffect, useState } from "react";
import {
  adminAssignSupervisor,
  adminCreateUser,
  adminImportUsers,
  adminListUsers,
  adminResetPin,
  adminUpdateUser,
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
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [importJson, setImportJson] = useState("[]");
  const [newUser, setNewUser] = useState({
    employeeId: "",
    name: "",
    dept: "",
    role: "EMPLOYEE",
    pin: "1234",
  });
  const [assignment, setAssignment] = useState({ employeeId: "", supervisorEmployeeId: "" });

  const loadUsers = async (search = "") => {
    setError("");
    try {
      const data = await adminListUsers(search);
      setUsers(data || []);
    } catch (err) {
      setError(err.message || "Failed");
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  const handleCreate = async () => {
    setMessage("");
    setError("");
    try {
      await adminCreateUser({
        employeeId: newUser.employeeId,
        name: newUser.name,
        dept: newUser.dept || undefined,
        role: newUser.role,
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
    try {
      await adminUpdateUser(user.id, {
        name: user.name,
        dept: user.dept,
        role: user.role,
        active: user.active,
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
        <button className="button" onClick={() => loadUsers(query)}>
          Search
        </button>
      </div>

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
          <input
            value={newUser.dept}
            onChange={(event) => setNewUser({ ...newUser, dept: event.target.value })}
          />
        </div>
        <div className="field">
          <label>Role</label>
          <select
            value={newUser.role}
            onChange={(event) => setNewUser({ ...newUser, role: event.target.value })}
          >
            {roles.map((role) => (
              <option key={role} value={role}>
                {role}
              </option>
            ))}
          </select>
        </div>
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

      <div className="card">
        <h2>Assign Supervisor</h2>
        <div className="field">
          <label>Employee ID</label>
          <input
            value={assignment.employeeId}
            onChange={(event) => setAssignment({ ...assignment, employeeId: event.target.value })}
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
      </div>

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
                  <input
                    value={user.dept || ""}
                    onChange={(event) =>
                      setUsers((prev) =>
                        prev.map((item) =>
                          item.id === user.id ? { ...item, dept: event.target.value } : item
                        )
                      )
                    }
                    placeholder="Dept"
                  />
                </div>
              </div>
              <div className="list-controls">
                <select
                  value={user.role}
                  onChange={(event) =>
                    setUsers((prev) =>
                      prev.map((item) =>
                        item.id === user.id ? { ...item, role: event.target.value } : item
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
