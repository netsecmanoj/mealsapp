import { useState } from "react";
import { getDailyReport } from "../lib/api.js";
import { todayStr } from "../lib/date.js";

export default function Report() {
  const [date, setDate] = useState(todayStr());
  const [counts, setCounts] = useState(null);
  const [served, setServed] = useState(null);
  const [checkins, setCheckins] = useState(null);
  const [waste, setWaste] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleFetch = async () => {
    setMessage("");
    setError("");
    try {
      const data = await getDailyReport(date);
      setCounts(data?.counts || null);
      setServed(data?.served || null);
      setCheckins(data?.checkins || null);
      setWaste(data?.waste || null);
      setMessage("Saved");
    } catch (err) {
      setCounts(null);
      setServed(null);
      setCheckins(null);
      setWaste(null);
      setError(err.message || "Failed");
    }
  };

  const handleExport = () => {
    if (!counts || !served) return;
    const rows = [
      ["Meal", "Planned Yes", "Planned No", "Not Set", "Checkins", "Waste"],
      ["Breakfast", counts.BREAKFAST?.yes ?? "", counts.BREAKFAST?.no ?? "", counts.BREAKFAST?.notSet ?? "", checkins?.BREAKFAST ?? "", waste?.BREAKFAST ?? ""],
      ["Lunch", counts.LUNCH?.yes ?? "", counts.LUNCH?.no ?? "", counts.LUNCH?.notSet ?? "", checkins?.LUNCH ?? "", waste?.LUNCH ?? ""],
      ["Dinner", counts.DINNER?.yes ?? "", counts.DINNER?.no ?? "", counts.DINNER?.notSet ?? "", checkins?.DINNER ?? "", waste?.DINNER ?? ""],
    ];
    const csv = rows.map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `meal-report-${date}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleCopy = async () => {
    if (!counts) return;
    const text = `Date: ${date}\nBreakfast: ${counts.BREAKFAST?.yes ?? 0}\nLunch: ${counts.LUNCH?.yes ?? 0}\nDinner: ${counts.DINNER?.yes ?? 0}`;
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
        <button className="button secondary" onClick={handleExport} disabled={!counts}>
          Export CSV
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
            <p>
              {served?.BREAKFAST
                ? `Yes ${counts.BREAKFAST?.yes ?? 0} · No ${counts.BREAKFAST?.no ?? 0} · Not set ${counts.BREAKFAST?.notSet ?? 0}`
                : "N/A"}
            </p>
            {served?.BREAKFAST ? (
              <div className="report-meta">
                Check-ins: {checkins?.BREAKFAST ?? 0} · Waste: {waste?.BREAKFAST ?? 0}
              </div>
            ) : null}
          </div>
          <div className="report-card">
            <h3>Lunch</h3>
            <p>
              {served?.LUNCH
                ? `Yes ${counts.LUNCH?.yes ?? 0} · No ${counts.LUNCH?.no ?? 0} · Not set ${counts.LUNCH?.notSet ?? 0}`
                : "N/A"}
            </p>
            {served?.LUNCH ? (
              <div className="report-meta">
                Check-ins: {checkins?.LUNCH ?? 0} · Waste: {waste?.LUNCH ?? 0}
              </div>
            ) : null}
          </div>
          <div className="report-card">
            <h3>Dinner</h3>
            <p>
              {served?.DINNER
                ? `Yes ${counts.DINNER?.yes ?? 0} · No ${counts.DINNER?.no ?? 0} · Not set ${counts.DINNER?.notSet ?? 0}`
                : "N/A"}
            </p>
            {served?.DINNER ? (
              <div className="report-meta">
                Check-ins: {checkins?.DINNER ?? 0} · Waste: {waste?.DINNER ?? 0}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
