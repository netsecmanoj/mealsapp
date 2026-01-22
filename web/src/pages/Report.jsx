import { useState } from "react";
import { getDailyReport } from "../lib/api.js";
import { todayStr } from "../lib/date.js";

export default function Report() {
  const [date, setDate] = useState(todayStr());
  const [counts, setCounts] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleFetch = async () => {
    setMessage("");
    setError("");
    try {
      const data = await getDailyReport(date);
      setCounts(data?.counts || null);
      setMessage("Saved");
    } catch (err) {
      setCounts(null);
      setError(err.message || "Failed");
    }
  };

  const handleCopy = async () => {
    if (!counts) return;
    const text = `Date: ${date}\nBreakfast: ${counts.BREAKFAST ?? 0}\nLunch: ${counts.LUNCH ?? 0}\nDinner: ${counts.DINNER ?? 0}`;
    try {
      await navigator.clipboard.writeText(text);
      setMessage("Copied");
    } catch (err) {
      setError(err.message || "Failed");
    }
  };

  return (
    <div className="app">
      <div className="card">
        <h2>Daily Report</h2>
        <div className="field">
          <label htmlFor="date">Date</label>
          <input
            id="date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
        <button className="button" onClick={handleFetch}>
          Get Report
        </button>
        {counts ? (
          <button className="button secondary" onClick={handleCopy}>
            Copy report to clipboard
          </button>
        ) : null}
      </div>

      {message ? <div className="message success">{message}</div> : null}
      {error ? <div className="message error">{error}</div> : null}

      {counts ? (
        <div className="card">
          <div className="report-header">
            <h2>Report Date</h2>
            <div className="report-date">{date}</div>
          </div>
        </div>
      ) : null}

      {counts ? (
        <div className="cards">
          <div className="report-card">
            <h3>Breakfast</h3>
            <p>{counts.BREAKFAST ?? 0}</p>
          </div>
          <div className="report-card">
            <h3>Lunch</h3>
            <p>{counts.LUNCH ?? 0}</p>
          </div>
          <div className="report-card">
            <h3>Dinner</h3>
            <p>{counts.DINNER ?? 0}</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}
