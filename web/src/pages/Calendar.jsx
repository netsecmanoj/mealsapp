import { useEffect, useMemo, useState } from "react";
import { getEffectiveChoices } from "../lib/api.js";
import { todayStr, tomorrowStr } from "../lib/date.js";

const mealTypes = ["BREAKFAST", "LUNCH", "DINNER"];

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function Calendar() {
  const [monthDate, setMonthDate] = useState(() => new Date());
  const [choicesMap, setChoicesMap] = useState({});
  const [selectedDate, setSelectedDate] = useState(todayStr());
  const [error, setError] = useState("");
  const [tomorrowSummary, setTomorrowSummary] = useState(null);

  const range = useMemo(() => {
    const start = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const end = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
    return { from: formatLocalDate(start), to: formatLocalDate(end) };
  }, [monthDate]);

  useEffect(() => {
    let active = true;
    setError("");
    getEffectiveChoices(range.from, range.to)
      .then((rows) => {
        if (!active) return;
        const map = {};
        for (const item of rows || []) {
          if (!map[item.date]) map[item.date] = {};
          map[item.date][item.mealType] = item;
        }
        setChoicesMap(map);
      })
      .catch((err) => {
        if (!active) return;
        setError(err.message || "Failed");
      });
    return () => {
      active = false;
    };
  }, [range.from, range.to]);

  useEffect(() => {
    let active = true;
    const tomorrow = tomorrowStr();
    getEffectiveChoices(tomorrow, tomorrow)
      .then((rows) => {
        if (!active) return;
        const summary = { BREAKFAST: 0, LUNCH: 0, DINNER: 0 };
        for (const item of rows || []) {
          if (item.status === "NA" || item.served === false) continue;
          if (item.wantMeal === true) {
            summary[item.mealType] += 1;
          }
        }
        setTomorrowSummary({ date: tomorrow, counts: summary });
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  const daysInMonth = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  const firstDayOfWeek = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1).getDay();
  const gridCells = [];
  for (let i = 0; i < firstDayOfWeek; i += 1) {
    gridCells.push(null);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const dateStr = formatLocalDate(new Date(monthDate.getFullYear(), monthDate.getMonth(), day));
    gridCells.push(dateStr);
  }

  const selected = choicesMap[selectedDate] || {};

  return (
    <div className="app">
      <div className="card">
        <h2>Meal Calendar</h2>
        <div className="calendar-toolbar">
          <button
            className="button secondary"
            onClick={() => setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() - 1, 1))}
          >
            Prev
          </button>
          <div className="calendar-title">
            {monthDate.toLocaleString("default", { month: "long" })} {monthDate.getFullYear()}
          </div>
          <button
            className="button secondary"
            onClick={() => setMonthDate(new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 1))}
          >
            Next
          </button>
        </div>
        {error ? <div className="message error">{error}</div> : null}
        {tomorrowSummary ? (
          <div className="summary">
            Tomorrow expected YES: B {tomorrowSummary.counts.BREAKFAST} · L {tomorrowSummary.counts.LUNCH} · D {tomorrowSummary.counts.DINNER}
          </div>
        ) : null}
      </div>

      <div className="calendar-grid">
        {gridCells.map((dateStr, index) => {
          if (!dateStr) {
            return <div className="calendar-cell empty" key={`empty-${index}`} />;
          }
          const dayChoices = choicesMap[dateStr] || {};
          const officeOpen =
            dayChoices.BREAKFAST?.officeOpen ??
            dayChoices.LUNCH?.officeOpen ??
            dayChoices.DINNER?.officeOpen ??
            true;
          return (
            <button
              key={dateStr}
              type="button"
              className={`calendar-cell ${selectedDate === dateStr ? "selected" : ""}`.trim()}
              onClick={() => setSelectedDate(dateStr)}
            >
              <div className="calendar-date">{Number(dateStr.split("-")[2])}</div>
              <div className={`calendar-badge ${officeOpen ? "open" : "closed"}`}>
                {officeOpen ? "Open" : "Closed"}
              </div>
              <div className="calendar-dots">
                {mealTypes.map((mealType) => {
                  const item = dayChoices[mealType];
                  const served = item?.served !== false;
                  const status = item?.status || "NOT_SET";
                  const label = status === "EXPLICIT" || status === "DEFAULT"
                    ? item?.wantMeal
                      ? "YES"
                      : "NO"
                    : status === "NA"
                      ? "NA"
                      : "NOT_SET";
                  return (
                    <span key={mealType} className={served ? "dot on" : "dot"}>
                      {mealType[0]}:{label}
                    </span>
                  );
                })}
              </div>
            </button>
          );
        })}
      </div>

      <div className="card">
        <h2>Details: {selectedDate}</h2>
        {mealTypes.map((mealType) => {
          const item = selected[mealType];
          const status = item?.status || "NOT_SET";
          const servedText = item?.served === false ? "Not served" : "Served";
          const cutoffText = item?.cutoffLabel ? `Cutoff ${item.cutoffLabel}` : "";
          const choiceText =
            status === "EXPLICIT"
              ? `Selected ${item.wantMeal ? "YES" : "NO"}`
              : status === "DEFAULT"
                ? `Default ${item.wantMeal ? "YES" : "NO"}`
                : status === "NA"
                  ? "N/A"
                  : "Not set";
          return (
            <div className="row" key={mealType}>
              <div className="row-left">
                <div className="row-title">{mealType}</div>
                <div className="row-status">{servedText}</div>
                <div className="row-lock">{choiceText}</div>
                {item?.overridden ? <div className="row-badge">Overridden by HR</div> : null}
              </div>
              <div>{cutoffText}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
