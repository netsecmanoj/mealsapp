import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { clearSession, getEffectiveChoices, getSession, setMyChoice } from "../lib/api.js";
import { todayStr, tomorrowStr } from "../lib/date.js";

const mealTypes = ["BREAKFAST", "LUNCH", "DINNER"];
const keyFor = (date, mealType) => `${date}|${mealType}`;

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
        const choicesData = await getEffectiveChoices(from, to);
        const next = {};
        for (const item of choicesData || []) {
          next[keyFor(item.date, item.mealType)] = item;
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
        [keyFor(date, mealType)]: {
          ...(prev[keyFor(date, mealType)] || {}),
          date,
          mealType,
          status: "EXPLICIT",
          wantMeal,
          served: true,
        },
      }));
      setMessage("Saved");
    } catch (err) {
      if (err?.message === "Cutoff passed") {
        setLocked((prev) => ({ ...prev, [keyFor(date, mealType)]: true }));
        setError("Cutoff passed");
      } else if (err?.message === "Meal not served") {
        setChoices((prev) => ({
          ...prev,
          [keyFor(date, mealType)]: {
            ...(prev[keyFor(date, mealType)] || {}),
            date,
            mealType,
            status: "NA",
            wantMeal: null,
            served: false,
          },
        }));
        setError("Meal not served");
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
            const key = keyFor(section.date, mealType);
            const item = choices[key];
            const value = item?.wantMeal ?? null;
            const isLocked = locked[key];
            const status =
              item?.status === "EXPLICIT"
                ? `Selected: ${value ? "YES" : "NO"}`
                : item?.status === "DEFAULT"
                  ? `Default: ${value ? "YES" : "NO"}`
                  : item?.status === "NA"
                    ? "Not served / Office closed"
                    : "Not set";
            const cutoffLabel = item?.cutoffLabel ? `Locked after ${item.cutoffLabel}` : null;
            const overrideLabel = item?.overridden ? "Overridden by HR" : null;
            const disableButtons = isLocked || item?.status === "NA" || item?.cutoffPassed === true;
            return (
              <div className="row" key={mealType}>
                <div className="row-left">
                  <div className="row-title">{mealType}</div>
                  <div className="row-status">{status}</div>
                  {overrideLabel ? <div className="row-badge">{overrideLabel}</div> : null}
                  {cutoffLabel && item?.status !== "NA" ? (
                    <div className="row-lock">{cutoffLabel}</div>
                  ) : null}
                </div>
                <div className="button-group">
                  <button
                    className={`big-button yes ${value === true ? "selected" : ""}`.trim()}
                    disabled={disableButtons}
                    onClick={() => handleChoice(section.date, mealType, true)}
                  >
                    YES
                  </button>
                  <button
                    className={`big-button no ${value === false ? "selected" : ""}`.trim()}
                    disabled={disableButtons}
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
