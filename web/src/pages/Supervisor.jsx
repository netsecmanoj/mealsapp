import { useEffect, useState } from "react";
import {
  createVisitor,
  getSession,
  getVisitorMeals,
  listUsers,
  searchVisitors,
  setStaffChoice,
  setVisitorMeals,
} from "../lib/api.js";
import { todayStr } from "../lib/date.js";

const mealTypes = ["BREAKFAST", "LUNCH", "DINNER"];

export default function Supervisor() {
  const [mode, setMode] = useState("employee");
  const [users, setUsers] = useState([]);
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState(todayStr());
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [overrides, setOverrides] = useState({});
  const [visitorQuery, setVisitorQuery] = useState("");
  const [visitorResults, setVisitorResults] = useState([]);
  const [selectedVisitor, setSelectedVisitor] = useState(null);
  const [visitorForm, setVisitorForm] = useState({ name: "", phone: "", company: "" });
  const [visitorMeals, setVisitorMealsState] = useState({
    BREAKFAST: null,
    LUNCH: null,
    DINNER: null,
  });
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

  useEffect(() => {
    if (mode !== "visitor") return;
    if (!visitorQuery.trim()) {
      setVisitorResults([]);
      return;
    }
    let active = true;
    const timer = setTimeout(() => {
      searchVisitors(visitorQuery)
        .then((data) => {
          if (!active) return;
          setVisitorResults(data || []);
        })
        .catch((err) => {
          if (!active) return;
          setError(err.message || "Failed to search visitors");
        });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [visitorQuery, mode]);

  useEffect(() => {
    if (mode !== "visitor" || !selectedVisitor?.id) return;
    getVisitorMeals(selectedVisitor.id, date)
      .then((data) => {
        setVisitorMealsState({
          BREAKFAST: data?.breakfast ?? null,
          LUNCH: data?.lunch ?? null,
          DINNER: data?.dinner ?? null,
        });
      })
      .catch((err) => {
        setError(err.message || "Failed to load visitor meals");
      });
  }, [mode, selectedVisitor, date]);

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

  const handleSelectVisitor = (visitor) => {
    setSelectedVisitor(visitor);
    setVisitorQuery(visitor.name);
    setVisitorResults([]);
  };

  const handleCreateVisitor = async () => {
    setMessage("");
    setError("");
    try {
      const created = await createVisitor(visitorForm);
      setSelectedVisitor(created);
      setVisitorQuery(created.name);
      setVisitorResults([]);
      setMessage("Visitor saved");
    } catch (err) {
      setError(err.message || "Failed to create visitor");
    }
  };

  const handleVisitorMeal = (mealType, value) => {
    setVisitorMealsState((prev) => ({ ...prev, [mealType]: value }));
  };

  const handleSaveVisitorMeals = async () => {
    if (!selectedVisitor?.id) {
      setError("Select a visitor first");
      return;
    }
    setMessage("");
    setError("");
    try {
      await setVisitorMeals(selectedVisitor.id, {
        date,
        breakfast: visitorMeals.BREAKFAST,
        lunch: visitorMeals.LUNCH,
        dinner: visitorMeals.DINNER,
        overrideReason: reason || undefined,
      });
      setMessage("Visitor meals saved");
    } catch (err) {
      setError(err.message || "Failed to save visitor meals");
    }
  };

  return (
    <div className="app">
      <div className="card">
        <h2>Supervisor Entry</h2>
        <div className="pill-row">
          <button
            className={`pill ${mode === "employee" ? "active" : ""}`}
            onClick={() => setMode("employee")}
            type="button"
          >
            Employee
          </button>
          <button
            className={`pill ${mode === "visitor" ? "active" : ""}`}
            onClick={() => setMode("visitor")}
            type="button"
          >
            Visitor
          </button>
        </div>
        {mode === "employee" ? (
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
        ) : (
          <>
            <div className="field">
              <label htmlFor="visitorSearch">Search visitor by name/phone</label>
              <input
                id="visitorSearch"
                value={visitorQuery}
                onChange={(event) => setVisitorQuery(event.target.value)}
              />
            </div>
            {visitorResults.length ? (
              <div className="list">
                {visitorResults.map((visitor) => (
                  <div className="list-row" key={visitor.id}>
                    <div>
                      <div className="row-title">{visitor.name}</div>
                      <div className="row-status">
                        {visitor.phone || "No phone"} {visitor.company ? `· ${visitor.company}` : ""}
                      </div>
                    </div>
                    <div className="list-controls">
                      <button className="button secondary" type="button" onClick={() => handleSelectVisitor(visitor)}>
                        Select
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <div className="card">
              <h3>Add new visitor</h3>
              <div className="field">
                <label htmlFor="visitorName">Name</label>
                <input
                  id="visitorName"
                  value={visitorForm.name}
                  onChange={(event) => setVisitorForm((prev) => ({ ...prev, name: event.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="visitorPhone">Phone</label>
                <input
                  id="visitorPhone"
                  value={visitorForm.phone}
                  onChange={(event) => setVisitorForm((prev) => ({ ...prev, phone: event.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="visitorCompany">Company</label>
                <input
                  id="visitorCompany"
                  value={visitorForm.company}
                  onChange={(event) => setVisitorForm((prev) => ({ ...prev, company: event.target.value }))}
                />
              </div>
              <button className="button" type="button" onClick={handleCreateVisitor}>
                Save visitor
              </button>
            </div>
            {selectedVisitor ? (
              <div className="card">
                <div className="row-title">
                  Selected visitor: {selectedVisitor.name} {selectedVisitor.phone ? `(${selectedVisitor.phone})` : ""}
                </div>
              </div>
            ) : null}
          </>
        )}
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
                className={`big-button yes ${
                  mode === "visitor" && visitorMeals[mealType] === "YES" ? "btn-selected" : ""
                }`.trim()}
                onClick={() => (mode === "employee" ? handleChoice(mealType, true) : handleVisitorMeal(mealType, "YES"))}
                disabled={mode === "employee" ? !employeeId : !selectedVisitor}
              >
                YES
              </button>
              <button
                className={`big-button no ${
                  mode === "visitor" && visitorMeals[mealType] === "NO" ? "btn-selected" : ""
                }`.trim()}
                onClick={() => (mode === "employee" ? handleChoice(mealType, false) : handleVisitorMeal(mealType, "NO"))}
                disabled={mode === "employee" ? !employeeId : !selectedVisitor}
              >
                NO
              </button>
              {mode === "visitor" ? (
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => handleVisitorMeal(mealType, null)}
                  disabled={!selectedVisitor}
                >
                  Clear
                </button>
              ) : null}
            </div>
          </div>
        ))}
        {mode === "visitor" ? (
          <button className="button" type="button" onClick={handleSaveVisitorMeals} disabled={!selectedVisitor}>
            Save visitor meals
          </button>
        ) : null}
      </div>
      {message ? <div className="message success">{message}</div> : null}
      {error ? <div className="message error">{error}</div> : null}
    </div>
  );
}
