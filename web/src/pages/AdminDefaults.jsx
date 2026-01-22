import { useState } from "react";
import { adminApplyDefaults } from "../lib/api.js";

const days = [
  { label: "Mon", bit: 1 << 0 },
  { label: "Tue", bit: 1 << 1 },
  { label: "Wed", bit: 1 << 2 },
  { label: "Thu", bit: 1 << 3 },
  { label: "Fri", bit: 1 << 4 },
  { label: "Sat", bit: 1 << 5 },
  { label: "Sun", bit: 1 << 6 },
];
const mealTypes = ["BREAKFAST", "LUNCH", "DINNER"];

export default function AdminDefaults() {
  const [dept, setDept] = useState("");
  const [userIds, setUserIds] = useState("");
  const [allActive, setAllActive] = useState(false);
  const [selectedDays, setSelectedDays] = useState(days.map((d) => d.bit));
  const [selectedMeals, setSelectedMeals] = useState(["LUNCH"]);
  const [defaultWantMeal, setDefaultWantMeal] = useState(true);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reason, setReason] = useState("");
  const [clearDefaults, setClearDefaults] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const daysMask = selectedDays.reduce((acc, bit) => acc | bit, 0);

  const handleApply = async () => {
    setMessage("");
    setError("");
    const scope = {
      ...(userIds.trim()
        ? { userIds: userIds.split(",").map((value) => value.trim()).filter(Boolean) }
        : {}),
      ...(dept.trim() ? { dept: dept.trim() } : {}),
      ...(allActive ? { allActive: true } : {}),
    };
    try {
      await adminApplyDefaults({
        scope,
        rules: selectedMeals.map((mealType) => ({
          mealType,
          defaultWantMeal: clearDefaults ? undefined : defaultWantMeal,
          daysMask,
          startDate: startDate || null,
          endDate: endDate || null,
          active: !clearDefaults,
        })),
        reason: reason || undefined,
      });
      setMessage("Defaults applied");
    } catch (err) {
      setError(err.message || "Failed");
    }
  };

  const toggleMeal = (mealType) => {
    setSelectedMeals((prev) =>
      prev.includes(mealType) ? prev.filter((item) => item !== mealType) : [...prev, mealType]
    );
  };

  const toggleDay = (bit) => {
    setSelectedDays((prev) =>
      prev.includes(bit) ? prev.filter((item) => item !== bit) : [...prev, bit]
    );
  };

  return (
    <div className="app">
      <div className="card">
        <h2>Apply Defaults</h2>
        <div className="field">
          <label>Scope: User IDs (comma separated)</label>
          <input value={userIds} onChange={(event) => setUserIds(event.target.value)} />
        </div>
        <div className="field">
          <label>Scope: Dept</label>
          <input value={dept} onChange={(event) => setDept(event.target.value)} />
        </div>
        <label className="toggle">
          <input type="checkbox" checked={allActive} onChange={(event) => setAllActive(event.target.checked)} />
          All active users
        </label>
      </div>

      <div className="card">
        <h2>Rules</h2>
        <div className="field">
          <label>Meals</label>
          <div className="pill-row">
            {mealTypes.map((meal) => (
              <button
                key={meal}
                type="button"
                className={`pill ${selectedMeals.includes(meal) ? "active" : ""}`}
                onClick={() => toggleMeal(meal)}
              >
                {meal}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Days</label>
          <div className="pill-row">
            {days.map((day) => (
              <button
                key={day.label}
                type="button"
                className={`pill ${selectedDays.includes(day.bit) ? "active" : ""}`}
                onClick={() => toggleDay(day.bit)}
              >
                {day.label}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label>Default</label>
          <select
            value={defaultWantMeal ? "YES" : "NO"}
            onChange={(event) => setDefaultWantMeal(event.target.value === "YES")}
          >
            <option value="YES">YES</option>
            <option value="NO">NO</option>
          </select>
        </div>
        <div className="field">
          <label>Start Date</label>
          <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} />
        </div>
        <div className="field">
          <label>End Date</label>
          <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} />
        </div>
        <label className="toggle">
          <input
            type="checkbox"
            checked={clearDefaults}
            onChange={(event) => setClearDefaults(event.target.checked)}
          />
          Clear defaults instead of apply
        </label>
        <div className="field">
          <label>Reason</label>
          <input value={reason} onChange={(event) => setReason(event.target.value)} />
        </div>
        <button className="button" onClick={handleApply}>
          Apply defaults
        </button>
      </div>

      {message ? <div className="message success">{message}</div> : null}
      {error ? <div className="message error">{error}</div> : null}
    </div>
  );
}
