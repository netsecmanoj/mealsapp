import { useEffect, useState } from "react";
import { getSession, listUsers, setStaffChoice } from "../lib/api.js";
import { todayStr } from "../lib/date.js";

const mealTypes = ["BREAKFAST", "LUNCH", "DINNER"];

export default function Supervisor() {
  const [users, setUsers] = useState([]);
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState(todayStr());
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [overrides, setOverrides] = useState({});
  const role = getSession()?.user?.role;
  const isHr = role === "HR_ADMIN" || role === "SUPER_ADMIN";

  useEffect(() => {
    let active = true;
    listUsers()
      .then((data) => {
        if (!active) return;
        setUsers(data || []);
        if (data?.length) {
          setEmployeeId(data[0].employeeId);
        }
      })
      .catch((err) => {
        if (!active) return;
        setError(err.message || "Failed to load users");
      });

    return () => {
      active = false;
    };
  }, []);

  const handleChoice = async (mealType, wantMeal) => {
    setMessage("");
    setError("");
    try {
      const result = await setStaffChoice(employeeId, date, mealType, wantMeal, reason);
      if (result?.overridden) {
        setOverrides((prev) => ({ ...prev, [mealType]: true }));
        setMessage("Saved (Overridden by HR)");
      } else {
        setMessage("Saved");
      }
    } catch (err) {
      setError(err.message || "Failed");
    }
  };

  return (
    <div className="app">
      <div className="card">
        <h2>Supervisor Entry</h2>
        <div className="field">
          <label htmlFor="employee">Employee</label>
          <select
            id="employee"
            value={employeeId}
            onChange={(event) => setEmployeeId(event.target.value)}
          >
            {users.map((user) => (
              <option key={user.employeeId} value={user.employeeId}>
                {user.name} ({user.employeeId})
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="date">Date</label>
          <input
            id="date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
        {isHr ? (
          <div className="field">
            <label htmlFor="reason">Override reason (required after cutoff)</label>
            <input
              id="reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
        ) : null}
        {mealTypes.map((mealType) => (
          <div className="row" key={mealType}>
            <div className="row-left">
              <div className="row-title">{mealType}</div>
              {overrides[mealType] ? <div className="row-badge">Overridden by HR</div> : null}
            </div>
            <div className="button-group">
              <button
                className="big-button yes"
                onClick={() => handleChoice(mealType, true)}
                disabled={!employeeId}
              >
                YES
              </button>
              <button
                className="big-button no"
                onClick={() => handleChoice(mealType, false)}
                disabled={!employeeId}
              >
                NO
              </button>
            </div>
          </div>
        ))}
      </div>
      {message ? <div className="message success">{message}</div> : null}
      {error ? <div className="message error">{error}</div> : null}
    </div>
  );
}
