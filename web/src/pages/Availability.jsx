import { useEffect, useMemo, useState } from "react";
import { applyAvailabilityTemplate, getServiceDays, updateServiceDay } from "../lib/api.js";

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDaysToDate(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export default function Availability() {
  const [monthDate, setMonthDate] = useState(() => new Date());
  const [serviceDays, setServiceDays] = useState({});
  const [selectedDate, setSelectedDate] = useState("");
  const [formState, setFormState] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isApplying, setIsApplying] = useState(false);
  const [keepSundaysClosed, setKeepSundaysClosed] = useState(true);
  const [overwriteExisting, setOverwriteExisting] = useState(false);

  const range = useMemo(() => {
    const start = new Date(monthDate.getFullYear(), monthDate.getMonth(), 1);
    const end = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0);
    return { from: formatLocalDate(start), to: formatLocalDate(end) };
  }, [monthDate]);

  useEffect(() => {
    let active = true;
    setError("");
    getServiceDays(range.from, range.to)
      .then((days) => {
        if (!active) return;
        const map = {};
        for (const day of days || []) {
          map[day.date] = day;
        }
        setServiceDays(map);
      })
      .catch((err) => {
        if (!active) return;
        setError(err.message || "Failed");
      });
    return () => {
      active = false;
    };
  }, [range.from, range.to]);

  const handleSelect = (dateStr) => {
    setSelectedDate(dateStr);
    const day = serviceDays[dateStr];
    setFormState(
      day || {
        date: dateStr,
        isOfficeOpen: true,
        breakfastServed: true,
        lunchServed: true,
        dinnerServed: true,
        note: "",
      }
    );
  };

  const handleToggle = (field) => (event) => {
    setFormState((prev) => ({ ...prev, [field]: event.target.checked }));
  };

  const handleNoteChange = (event) => {
    setFormState((prev) => ({ ...prev, note: event.target.value }));
  };

  const handleSave = async () => {
    if (!formState) return;
    setMessage("");
    setError("");
    try {
      const payload = {
        date: formState.date,
        isOfficeOpen: formState.isOfficeOpen,
        breakfastServed: formState.breakfastServed,
        lunchServed: formState.lunchServed,
        dinnerServed: formState.dinnerServed,
        note: formState.note || "",
      };
      const updated = await updateServiceDay(payload);
      setServiceDays((prev) => ({ ...prev, [updated.date]: updated }));
      setMessage("Saved");
    } catch (err) {
      setError(err.message || "Failed");
    }
  };

  const handleApplyTemplate = async (days) => {
    setMessage("");
    setError("");
    if (!formState) {
      setError("Select a date first");
      return;
    }
    setIsApplying(true);
    try {
      const startDate = formatLocalDate(addDaysToDate(new Date(), 1));
      const template = {
        officeOpen: !!formState.isOfficeOpen,
        breakfastServed: !!formState.breakfastServed,
        lunchServed: !!formState.lunchServed,
        dinnerServed: !!formState.dinnerServed,
      };
      const result = await applyAvailabilityTemplate({
        days,
        startDate,
        template,
        keepSundaysClosed,
        overwriteExisting,
      });
      const refreshed = await getServiceDays(range.from, range.to);
      const map = {};
      for (const day of refreshed || []) {
        map[day.date] = day;
      }
      setServiceDays(map);
      if (selectedDate) {
        const refreshedDay = map[selectedDate];
        if (refreshedDay) {
          setFormState(refreshedDay);
        }
      }
      if (result?.startDate && result?.endDate) {
        const updatedCount = result?.updatedCount ?? 0;
        const skippedCount = result?.skippedCount ?? 0;
        setMessage(
          `Template applied (${result.startDate} → ${result.endDate}). Updated ${updatedCount} days, skipped ${skippedCount} days.`
        );
        if (updatedCount === 0) {
          setError("No days updated (all days were skipped due to manual edits).");
        }
      } else {
        setMessage("Template applied");
      }
    } catch (err) {
      setError(err.message || "Failed");
    } finally {
      setIsApplying(false);
    }
  };

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

  return (
    <div className="app">
      <div className="card">
        <h2>Availability Calendar</h2>
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
        <div className="template-actions">
          <label className="toggle">
            <input
              type="checkbox"
              checked={keepSundaysClosed}
              onChange={(event) => setKeepSundaysClosed(event.target.checked)}
            />
            Keep Sundays closed
          </label>
          <label className="toggle">
            <input
              type="checkbox"
              checked={overwriteExisting}
              onChange={(event) => setOverwriteExisting(event.target.checked)}
            />
            Overwrite existing days
          </label>
          <button
            type="button"
            className="button"
            disabled={isApplying}
            onClick={(event) => {
              event.preventDefault();
              handleApplyTemplate(30);
            }}
          >
            Apply template to next 30 days
          </button>
          <button
            type="button"
            className="button"
            disabled={isApplying}
            onClick={(event) => {
              event.preventDefault();
              handleApplyTemplate(60);
            }}
          >
            Apply template to next 60 days
          </button>
          <button
            type="button"
            className="button"
            disabled={isApplying}
            onClick={(event) => {
              event.preventDefault();
              handleApplyTemplate(90);
            }}
          >
            Apply template to next 90 days
          </button>
        </div>
        {isApplying ? <div className="message">Applying...</div> : null}
      </div>

      <div className="calendar-grid">
        {gridCells.map((dateStr, index) => {
          if (!dateStr) {
            return <div className="calendar-cell empty" key={`empty-${index}`} />;
          }
          const day = serviceDays[dateStr];
          const closed = day ? !day.isOfficeOpen : false;
          const breakfast = day ? day.breakfastServed : true;
          const lunch = day ? day.lunchServed : true;
          const dinner = day ? day.dinnerServed : true;
          return (
            <button
              key={dateStr}
              type="button"
              className={`calendar-cell ${selectedDate === dateStr ? "selected" : ""}`.trim()}
              onClick={() => handleSelect(dateStr)}
            >
              <div className="calendar-date">{Number(dateStr.split("-")[2])}</div>
              {closed ? (
                <div className="calendar-closed">Closed</div>
              ) : (
                <div className="calendar-dots">
                  <span className={breakfast ? "dot on" : "dot"}>B</span>
                  <span className={lunch ? "dot on" : "dot"}>L</span>
                  <span className={dinner ? "dot on" : "dot"}>D</span>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {formState ? (
        <div className="card">
          <h2>Service Day: {formState.date}</h2>
          <div className="field checkbox">
            <label>
              <input
                type="checkbox"
                checked={formState.isOfficeOpen}
                onChange={handleToggle("isOfficeOpen")}
              />
              Office open
            </label>
          </div>
          <div className="field checkbox">
            <label>
              <input
                type="checkbox"
                checked={formState.breakfastServed}
                onChange={handleToggle("breakfastServed")}
              />
              Breakfast served
            </label>
          </div>
          <div className="field checkbox">
            <label>
              <input
                type="checkbox"
                checked={formState.lunchServed}
                onChange={handleToggle("lunchServed")}
              />
              Lunch served
            </label>
          </div>
          <div className="field checkbox">
            <label>
              <input
                type="checkbox"
                checked={formState.dinnerServed}
                onChange={handleToggle("dinnerServed")}
              />
              Dinner served
            </label>
          </div>
          <div className="field">
            <label htmlFor="note">Note</label>
            <input id="note" value={formState.note || ""} onChange={handleNoteChange} />
          </div>
          <button className="button" onClick={handleSave}>
            Save day
          </button>
          {message ? <div className="message success">{message}</div> : null}
          {error ? <div className="message error">{error}</div> : null}
        </div>
      ) : null}
    </div>
  );
}
