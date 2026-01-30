import { useEffect, useMemo, useState } from "react";
import { adminGetMasterData, adminUpdateMasterData } from "../lib/api.js";

const UNASSIGNED_LABEL = "Unassigned";
const MAX_ITEM_LENGTH = 60;
const MAX_ITEMS = 200;

function normalizeList(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    const trimmed = value.trim();
    if (!trimmed) continue;
    if (trimmed.length > MAX_ITEM_LENGTH) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }
  if (!seen.has(UNASSIGNED_LABEL.toLowerCase())) {
    result.push(UNASSIGNED_LABEL);
  }
  const sorted = result.sort((a, b) => {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();
    if (aLower === UNASSIGNED_LABEL.toLowerCase()) return -1;
    if (bLower === UNASSIGNED_LABEL.toLowerCase()) return 1;
    return a.localeCompare(b);
  });
  return sorted.slice(0, MAX_ITEMS);
}

export default function MasterData() {
  const [departments, setDepartments] = useState([]);
  const [sites, setSites] = useState([]);
  const [usage, setUsage] = useState({ departments: {}, sites: {} });
  const [deptInput, setDeptInput] = useState("");
  const [siteInput, setSiteInput] = useState("");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    setError("");
    try {
      const data = await adminGetMasterData();
      setDepartments(data?.departments || []);
      setSites(data?.sites || []);
      setUsage(data?.usage || { departments: {}, sites: {} });
    } catch (err) {
      setError(err.message || "Failed to load master data");
    }
  };

  useEffect(() => {
    load();
  }, []);

  const deptWarning = useMemo(() => {
    if (deptInput.trim().length > MAX_ITEM_LENGTH) return "Department name too long";
    return "";
  }, [deptInput]);

  const siteWarning = useMemo(() => {
    if (siteInput.trim().length > MAX_ITEM_LENGTH) return "Site name too long";
    return "";
  }, [siteInput]);

  const addDepartment = () => {
    setMessage("");
    if (deptWarning) {
      setError(deptWarning);
      return;
    }
    const next = normalizeList([...departments, deptInput]);
    setDepartments(next);
    setDeptInput("");
  };

  const addSite = () => {
    setMessage("");
    if (siteWarning) {
      setError(siteWarning);
      return;
    }
    const next = normalizeList([...sites, siteInput]);
    setSites(next);
    setSiteInput("");
  };

  const removeDepartment = (value) => {
    const next = normalizeList(departments.filter((item) => item !== value));
    setDepartments(next);
  };

  const removeSite = (value) => {
    const next = normalizeList(sites.filter((item) => item !== value));
    setSites(next);
  };

  const handleSave = async () => {
    setMessage("");
    setError("");
    if (!reason.trim()) {
      setError("Reason is required");
      return;
    }
    try {
      await adminUpdateMasterData({
        departments: departments,
        sites: sites,
        reason: reason.trim(),
      });
      setMessage("Master data updated");
      setReason("");
      load();
    } catch (err) {
      setError(err.message || "Failed to update master data");
    }
  };

  const isUnassigned = (value) => value.trim().toLowerCase() === UNASSIGNED_LABEL.toLowerCase();

  return (
    <div className="app">
      <div className="card">
        <h2>Master Data</h2>
        <p className="muted">
          Manage departments and sites used in user dropdowns. Removing values in use is blocked.
        </p>
      </div>

      <div className="card">
        <h2>Departments</h2>
        <div className="field">
          <label>Add Department</label>
          <input
            value={deptInput}
            onChange={(event) => setDeptInput(event.target.value)}
            placeholder="e.g. IT"
          />
        </div>
        <button className="button" onClick={addDepartment}>
          Add Department
        </button>
        {deptWarning ? <div className="message error">{deptWarning}</div> : null}
        <div className="list">
          {departments.map((dept) => {
            const count = usage.departments?.[dept] ?? 0;
            const unassigned = isUnassigned(dept);
            const disabled = count > 0;
            return (
              <div className="list-row" key={dept}>
                <div className="list-main">
                  <div className="row-title">{dept}</div>
                  <div className="row-status">In use: {count}</div>
                </div>
                <div className="list-controls">
                  <button
                    className="button secondary"
                    onClick={() => removeDepartment(dept)}
                    disabled={disabled || unassigned}
                  >
                    Remove
                  </button>
                  {unassigned ? (
                    <span className="muted">Unassigned cannot be removed</span>
                  ) : disabled ? (
                    <span className="muted">In use</span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h2>Sites</h2>
        <div className="field">
          <label>Add Site</label>
          <input
            value={siteInput}
            onChange={(event) => setSiteInput(event.target.value)}
            placeholder="e.g. HO-Bangalore"
          />
        </div>
        <button className="button" onClick={addSite}>
          Add Site
        </button>
        {siteWarning ? <div className="message error">{siteWarning}</div> : null}
        <div className="list">
          {sites.map((site) => {
            const count = usage.sites?.[site] ?? 0;
            const unassigned = isUnassigned(site);
            const disabled = count > 0;
            return (
              <div className="list-row" key={site}>
                <div className="list-main">
                  <div className="row-title">{site}</div>
                  <div className="row-status">In use: {count}</div>
                </div>
                <div className="list-controls">
                  <button
                    className="button secondary"
                    onClick={() => removeSite(site)}
                    disabled={disabled || unassigned}
                  >
                    Remove
                  </button>
                  {unassigned ? (
                    <span className="muted">Unassigned cannot be removed</span>
                  ) : disabled ? (
                    <span className="muted">In use</span>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card">
        <h2>Save Changes</h2>
        <div className="field">
          <label>Reason</label>
          <input
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            placeholder="Required for audit log"
          />
        </div>
        <button className="button" onClick={handleSave}>
          Save Master Data
        </button>
        {message ? <div className="message success">{message}</div> : null}
        {error ? <div className="message error">{error}</div> : null}
      </div>
    </div>
  );
}
