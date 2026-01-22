import { useEffect, useState } from "react";
import { adminDecideMealRequest, adminListMealRequests } from "../lib/api.js";
import { todayStr } from "../lib/date.js";

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysStr(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return formatLocalDate(date);
}

export default function Requests() {
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(addDaysStr(7));
  const [status, setStatus] = useState("PENDING");
  const [requests, setRequests] = useState([]);
  const [reasons, setReasons] = useState({});
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadRequests = async () => {
    setError("");
    try {
      const data = await adminListMealRequests(from, to, status || undefined);
      setRequests(data || []);
    } catch (err) {
      setError(err.message || "Failed");
    }
  };

  useEffect(() => {
    loadRequests();
  }, [from, to, status]);

  const handleDecision = async (id, decision) => {
    setMessage("");
    setError("");
    const reason = (reasons[id] || "").trim();
    if (!reason) {
      setError("Reason required");
      return;
    }
    try {
      await adminDecideMealRequest(id, decision, reason);
      setReasons((prev) => ({ ...prev, [id]: "" }));
      setMessage(`Request ${decision === "APPROVE" ? "approved" : "rejected"}`);
      await loadRequests();
    } catch (err) {
      setError(err.message || "Failed");
    }
  };

  return (
    <div className="app">
      <div className="card">
        <h2>Meal Requests</h2>
        <div className="grid">
          <div className="field">
            <label htmlFor="from">From</label>
            <input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="to">To</label>
            <input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="status">Status</label>
            <select id="status" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="PENDING">PENDING</option>
              <option value="APPROVED">APPROVED</option>
              <option value="REJECTED">REJECTED</option>
              <option value="CANCELLED">CANCELLED</option>
            </select>
          </div>
        </div>
        <button className="button" onClick={loadRequests}>
          Refresh
        </button>
      </div>

      {message ? <div className="message success">{message}</div> : null}
      {error ? <div className="message error">{error}</div> : null}

      <div className="list">
        {requests.map((req) => (
          <div className="list-row" key={req.id}>
            <div>
              <div className="row-title">
                {req.date} · {req.mealType}
              </div>
              <div className="row-status">
                {req.user?.name} ({req.user?.employeeId}) · {req.user?.dept || "Unassigned"}
              </div>
              {req.createdAt ? <div className="row-status">Created: {new Date(req.createdAt).toLocaleString()}</div> : null}
              {req.note ? <div className="row-status">Note: {req.note}</div> : null}
              <div className={`badge-${req.status.toLowerCase()}`}>{req.status}</div>
            </div>
            <div className="list-controls">
              <input
                type="text"
                placeholder="Reason (required)"
                value={reasons[req.id] || ""}
                onChange={(e) => setReasons((prev) => ({ ...prev, [req.id]: e.target.value }))}
              />
              <button className="button" onClick={() => handleDecision(req.id, "APPROVE")}>
                Approve
              </button>
              <button className="button secondary" onClick={() => handleDecision(req.id, "REJECT")}>
                Reject
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
