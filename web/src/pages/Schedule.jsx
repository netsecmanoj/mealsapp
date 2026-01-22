import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  cancelMealRequest,
  clearSession,
  createMealRequest,
  deleteChoice,
  getEffectiveChoices,
  getSession,
  setMyChoice,
} from "../lib/api.js";
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
  const role = session?.user?.role || "";
  const canOverrideCutoff = role === "HR_ADMIN" || role === "SUPER_ADMIN";

  const loadChoices = async (from, to) => {
    const choicesData = await getEffectiveChoices(from, to);
    const next = {};
    for (const item of choicesData || []) {
      next[keyFor(item.date, item.mealType)] = item;
    }
    setChoices(next);
  };

  const handleLogout = () => {
    clearSession();
    navigate("/login");
  };

  useEffect(() => {
    const init = async () => {
      setError("");
      try {
        const from = todayStr();
        const to = tomorrowStr();
        await loadChoices(from, to);
      } catch (err) {
        setError(err.message || "Failed");
      }
    };

    init();
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
          choiceStatus: "EXPLICIT",
          wantMeal,
          served: true,
          servedGlobal: true,
          officeOpen: true,
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
            choiceStatus: "NA",
            wantMeal: null,
            served: false,
            servedGlobal: false,
          },
        }));
        setError("Meal not served");
      } else {
        setError(err.message || "Failed");
      }
    }
  };

  const handleReset = async (date, mealType) => {
    setMessage("");
    setError("");
    try {
      const result = await deleteChoice(date, mealType);
      if (result?.choice) {
        setChoices((prev) => ({
          ...prev,
          [keyFor(date, mealType)]: result.choice,
        }));
      } else {
        const from = todayStr();
        const to = tomorrowStr();
        await loadChoices(from, to);
      }
      setMessage("Reset");
    } catch (err) {
      setError(err.message || "Failed");
    }
  };

  const handleRequest = async (date, mealType) => {
    setMessage("");
    setError("");
    try {
      await createMealRequest(date, mealType);
      const from = todayStr();
      const to = tomorrowStr();
      await loadChoices(from, to);
      setMessage("Request sent");
    } catch (err) {
      setError(err.message || "Failed");
    }
  };

  const handleCancelRequest = async (date, mealType) => {
    setMessage("");
    setError("");
    try {
      await cancelMealRequest(date, mealType);
      const from = todayStr();
      const to = tomorrowStr();
      await loadChoices(from, to);
      setMessage("Request canceled");
    } catch (err) {
      setError(err.message || "Failed");
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
            const isLocked = locked[key];
            const servedGlobal = item?.servedGlobal ?? item?.served ?? true;
            const officeOpen = item?.officeOpen !== false;
            const availabilityText = !officeOpen
              ? "Office closed"
              : servedGlobal
                ? "Meal availability: YES"
                : "Meal availability: NO";
            const choiceStatus = item?.choiceStatus || item?.status;
            const preferenceHint = item?.preferenceHintWantMeal;
            const status = servedGlobal
              ? choiceStatus === "EXPLICIT"
                ? `Selected: ${item?.wantMeal ? "YES" : "NO"}`
                : "Not set"
              : officeOpen
                ? item?.requestStatus === "PENDING"
                  ? "Request pending"
                  : item?.requestStatus === "APPROVED"
                    ? "Approved"
                    : item?.requestStatus === "REJECTED"
                      ? `Rejected: ${item?.requestReason || "No reason provided"}`
                      : "No request"
                : "Not served / Office closed";
            const cutoffLabel = item?.cutoffLabel ? `Locked after ${item.cutoffLabel}` : null;
            const overrideLabel = item?.overridden ? "Overridden by HR" : null;
            const disableButtons = isLocked || item?.cutoffPassed === true;
            const selectedYes = choiceStatus === "EXPLICIT" && item?.wantMeal === true;
            const selectedNo = choiceStatus === "EXPLICIT" && item?.wantMeal === false;
            const canRequest = officeOpen && !servedGlobal;
            const requestDisabled = (item?.cutoffPassed && !canOverrideCutoff) || isLocked;
            return (
              <div className="row" key={mealType}>
                <div className="row-left">
                  <div className="row-title">{mealType}</div>
                  <div
                    className={`choice-hint ${
                      availabilityText === "Office closed"
                        ? "badge-office-closed"
                        : availabilityText === "Meal availability: YES"
                          ? "badge-available-yes"
                          : "badge-available-no"
                    }`}
                  >
                    Availability: {availabilityText}
                  </div>
                  <div className="row-status">{status}</div>
                  {preferenceHint !== null && preferenceHint !== undefined ? (
                    <div className="row-status">Preference: {preferenceHint ? "YES" : "NO"}</div>
                  ) : null}
                  {overrideLabel ? <div className="row-badge">{overrideLabel}</div> : null}
                  {cutoffLabel && servedGlobal ? (
                    <div className="row-lock">{cutoffLabel}</div>
                  ) : null}
                </div>
                {servedGlobal ? (
                  <div className="button-group">
                    <button
                      className={`big-button yes ${selectedYes ? "btn-selected" : ""}`.trim()}
                      disabled={disableButtons}
                      onClick={() => handleChoice(section.date, mealType, true)}
                    >
                      YES
                    </button>
                    <button
                      className={`big-button no ${selectedNo ? "btn-selected" : ""}`.trim()}
                      disabled={disableButtons}
                      onClick={() => handleChoice(section.date, mealType, false)}
                    >
                      NO
                    </button>
                    {choiceStatus === "EXPLICIT" ? (
                      <button
                        className="reset-link"
                        type="button"
                        onClick={() => handleReset(section.date, mealType)}
                        disabled={disableButtons}
                      >
                        Reset
                      </button>
                    ) : null}
                  </div>
                ) : canRequest ? (
                  <div className="button-group">
                    {item?.requestStatus === "PENDING" ? (
                      <button
                        className="button secondary"
                        type="button"
                        disabled={requestDisabled}
                        onClick={() => handleCancelRequest(section.date, mealType)}
                      >
                        Cancel request
                      </button>
                    ) : item?.requestStatus === "APPROVED" ? (
                      <span className="badge-approved">Approved</span>
                    ) : item?.requestStatus === "REJECTED" ? (
                      <span className="badge-rejected">Rejected</span>
                    ) : (
                      <button
                        className="button"
                        type="button"
                        disabled={requestDisabled}
                        onClick={() => handleRequest(section.date, mealType)}
                      >
                        Request meal
                      </button>
                    )}
                  </div>
                ) : null}
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
