import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { clearSession, getMyChoices, getSession, setMyChoice } from "../lib/api.js";
import { todayStr, tomorrowStr } from "../lib/date.js";

const mealTypes = ["BREAKFAST", "LUNCH", "DINNER"];

export default function Schedule() {
  const navigate = useNavigate();
  const session = getSession();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [choices, setChoices] = useState({});
  const [locked, setLocked] = useState({});

  const handleLogout = () => {
    clearSession();
    navigate("/login");
  };

  useEffect(() => {
    const loadChoices = async () => {
      setError("");
      try {
        const from = todayStr();
        const to = tomorrowStr();
        const data = await getMyChoices(from, to);
        const next = {};
        for (const item of data || []) {
          next[`${item.date}|${item.mealType}`] = item.wantMeal;
        }
        setChoices(next);
      } catch (err) {
        setError(err.message || "Failed");
      }
    };

    loadChoices();
  }, []);

  const handleChoice = async (date, mealType, wantMeal) => {
    setMessage("");
    setError("");
    try {
      await setMyChoice(date, mealType, wantMeal);
      setChoices((prev) => ({
        ...prev,
        [`${date}|${mealType}`]: wantMeal,
      }));
      setMessage("Saved");
    } catch (err) {
      if (err?.message === "Cutoff passed") {
        setLocked((prev) => ({ ...prev, [`${date}|${mealType}`]: true }));
        setError("Cutoff passed");
      } else {
        setError(err.message || "Failed");
      }
    }
  };

  const sections = [
    { title: "Today", date: todayStr() },
    { title: "Tomorrow", date: tomorrowStr() },
  ];

  return (
    <div className="app">
      <div className="header">
        <div>
          <h2>Welcome, {session?.user?.name}</h2>
          <div className="muted">Schedule your meals</div>
        </div>
        <button className="button secondary" onClick={handleLogout}>
          Logout
        </button>
      </div>

      {sections.map((section) => (
        <div className="card" key={section.date}>
          <h2>
            {section.title} ({section.date})
          </h2>
          {mealTypes.map((mealType) => {
            const key = `${section.date}|${mealType}`;
            const value = choices[key];
            const isLocked = locked[key];
            const status =
              value === true
                ? "Selected: YES"
                : value === false
                  ? "Selected: NO"
                  : "Not set";
            const cutoffLabel =
              mealType === "BREAKFAST"
                ? "Locked after 09:00"
                : mealType === "LUNCH"
                  ? "Locked after 11:00"
                  : "Locked after 17:00";
            return (
              <div className="row" key={mealType}>
                <div className="row-left">
                  <div className="row-title">{mealType}</div>
                  <div className="row-status">{status}</div>
                  <div className="row-lock">{cutoffLabel}</div>
                </div>
                <div className="button-group">
                  <button
                    className={`big-button yes ${value === true ? "selected" : ""}`.trim()}
                    disabled={isLocked}
                    onClick={() => handleChoice(section.date, mealType, true)}
                  >
                    YES
                  </button>
                  <button
                    className={`big-button no ${value === false ? "selected" : ""}`.trim()}
                    disabled={isLocked}
                    onClick={() => handleChoice(section.date, mealType, false)}
                  >
                    NO
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ))}

      {message ? <div className="message success">{message}</div> : null}
      {error ? <div className="message error">{error}</div> : null}
    </div>
  );
}
