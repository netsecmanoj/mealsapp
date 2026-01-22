import { useEffect, useState } from "react";
import { clearSession, kioskCheckin, kioskStatus } from "../lib/api.js";
import { todayStr } from "../lib/date.js";

const mealTypes = ["BREAKFAST", "LUNCH", "DINNER"];

export default function Kiosk() {
  const [mealType, setMealType] = useState("LUNCH");
  const [lockedMeal, setLockedMeal] = useState(false);
  const [employeeId, setEmployeeId] = useState("");
  const [count, setCount] = useState(null);
  const [status, setStatus] = useState(null);
  const [recent, setRecent] = useState([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadStatus = async () => {
    setError("");
    try {
      const data = await kioskStatus(todayStr(), mealType);
      setStatus(data);
      setCount(data.checkedInCount);
      setRecent(data.recent || []);
    } catch (err) {
      setError(err.message || "Failed");
    }
  };

  useEffect(() => {
    loadStatus();
  }, [mealType]);

  const handleCheckin = async () => {
    setMessage("");
    setError("");
    try {
      const data = await kioskCheckin({
        employeeId: employeeId.trim(),
        date: todayStr(),
        mealType,
      });
      setCount(data?.totals?.checkedInCount ?? count);
      setRecent(data?.recent || recent);
      if (data?.ok === false) {
        setMessage(data.message || "Already checked in");
      } else {
        setMessage("Marked taken");
      }
      setEmployeeId("");
    } catch (err) {
      setError(err.message || "Failed");
    }
  };

  return (
    <div className="app kiosk">
      <div className="card">
        <h2>Meal Check-in</h2>
        <div className="field">
          <label>Meal</label>
          <select
            value={mealType}
            onChange={(event) => setMealType(event.target.value)}
            disabled={lockedMeal}
          >
            {mealTypes.map((meal) => (
              <option key={meal} value={meal}>
                {meal}
              </option>
            ))}
          </select>
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={lockedMeal}
            onChange={(event) => setLockedMeal(event.target.checked)}
          />
          Lock meal type
        </label>
        <div className="field">
          <label>Employee ID</label>
          <input
            className="kiosk-input"
            value={employeeId}
            onChange={(event) => setEmployeeId(event.target.value)}
            placeholder="E4001"
          />
        </div>
        <button className="button kiosk-button" onClick={handleCheckin}>
          Mark Taken
        </button>
        <button className="button secondary" onClick={() => { clearSession(); window.location.href = "/login"; }}>
          Logout
        </button>
      </div>

      <div className="card">
        <h2>Status</h2>
        <div className="row-status">{status?.served ? "Served" : "Not served"}</div>
        {status && !status.served ? (
          <div className="message error">Office closed or meal not served</div>
        ) : null}
        <div className="row-status">Checked-in: {count ?? 0}</div>
        <div className="recent-list">
          {recent.map((item, index) => (
            <div key={`${item.employeeId}-${index}`} className="row-status">
              {item.employeeId} · {new Date(item.takenAt).toLocaleTimeString()}
            </div>
          ))}
        </div>
      </div>

      {message ? <div className="message success">{message}</div> : null}
      {error ? <div className="message error">{error}</div> : null}
    </div>
  );
}
