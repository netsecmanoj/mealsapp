import { useMemo, useState } from "react";
import { getDailyReport, getDailyReportDetails } from "../lib/api.js";
import { todayStr } from "../lib/date.js";

export default function Report() {
  const [date, setDate] = useState(todayStr());
  const [counts, setCounts] = useState(null);
  const [served, setServed] = useState(null);
  const [approvedRequests, setApprovedRequests] = useState(null);
  const [checkins, setCheckins] = useState(null);
  const [waste, setWaste] = useState(null);
  const [mode, setMode] = useState("summary");
  const [detailView, setDetailView] = useState("combined");
  const [detailMealType, setDetailMealType] = useState("BREAKFAST");
  const [detailRows, setDetailRows] = useState([]);
  const [detailVisitors, setDetailVisitors] = useState([]);
  const [detailMeta, setDetailMeta] = useState(null);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const handleFetch = async () => {
    setMessage("");
    setError("");
    try {
      const data = await getDailyReport(date);
      setCounts(data?.counts || null);
      setServed(data?.served || null);
      setApprovedRequests(data?.approvedRequests || null);
      setCheckins(data?.checkins || null);
      setWaste(data?.waste || null);
      setMessage("Saved");
    } catch (err) {
      setCounts(null);
      setServed(null);
      setApprovedRequests(null);
      setCheckins(null);
      setWaste(null);
      setError(err.message || "Failed");
    }
  };

  const handleFetchDetails = async () => {
    setMessage("");
    setError("");
    try {
      const data = await getDailyReportDetails(
        date,
        detailView,
        detailView === "meal" ? detailMealType : undefined
      );
      setDetailRows(data?.rows || []);
      setDetailVisitors(data?.visitors || []);
      setDetailMeta({
        officeOpen: data?.officeOpen ?? true,
        serviceDay: data?.serviceDay || null,
      });
      setMessage("Details loaded");
    } catch (err) {
      setDetailRows([]);
      setDetailVisitors([]);
      setDetailMeta(null);
      setError(err.message || "Failed");
    }
  };

  const handleExport = () => {
    if (!counts || !served) return;
    const rows = [
      ["Meal", "Planned Yes", "Planned No", "Not Set", "Approved Requests", "Checkins", "Waste"],
      [
        "Breakfast",
        counts.BREAKFAST?.yes ?? "",
        counts.BREAKFAST?.no ?? "",
        counts.BREAKFAST?.notSet ?? "",
        approvedRequests?.BREAKFAST ?? "",
        checkins?.BREAKFAST ?? "",
        waste?.BREAKFAST ?? "",
      ],
      [
        "Lunch",
        counts.LUNCH?.yes ?? "",
        counts.LUNCH?.no ?? "",
        counts.LUNCH?.notSet ?? "",
        approvedRequests?.LUNCH ?? "",
        checkins?.LUNCH ?? "",
        waste?.LUNCH ?? "",
      ],
      [
        "Dinner",
        counts.DINNER?.yes ?? "",
        counts.DINNER?.no ?? "",
        counts.DINNER?.notSet ?? "",
        approvedRequests?.DINNER ?? "",
        checkins?.DINNER ?? "",
        waste?.DINNER ?? "",
      ],
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

  const formatSelected = (cell) => {
    if (!cell || cell.selected === "NA") return "N/A";
    if (cell.selected === "NOT_SET") return "Not set";
    return cell.selected;
  };

  const filteredRows = detailRows.filter((row) => {
    if (!search.trim()) return true;
    const term = search.toLowerCase();
    return (
      row.employeeId?.toLowerCase().includes(term) ||
      row.name?.toLowerCase().includes(term)
    );
  });

  const detailCounts = useMemo(() => {
    const totalEmployees = detailRows.length;
    const shownEmployees = filteredRows.length;
    const counts = {
      totalEmployees,
      shownEmployees,
      meals: {
        BREAKFAST: { yes: 0, no: 0, notSet: 0, requests: {} },
        LUNCH: { yes: 0, no: 0, notSet: 0, requests: {} },
        DINNER: { yes: 0, no: 0, notSet: 0, requests: {} },
      },
    };
    const mealsToCount = detailView === "meal" ? [detailMealType] : ["BREAKFAST", "LUNCH", "DINNER"];
    for (const row of filteredRows) {
      for (const meal of mealsToCount) {
        const cell = row[meal.toLowerCase()];
        if (!cell) continue;
        if (cell.selected === "YES") counts.meals[meal].yes += 1;
        else if (cell.selected === "NO") counts.meals[meal].no += 1;
        else if (cell.selected === "NOT_SET") counts.meals[meal].notSet += 1;
        if (cell.final === "NA" && cell.requestStatus) {
          const key = cell.requestStatus;
          counts.meals[meal].requests[key] = (counts.meals[meal].requests[key] || 0) + 1;
        }
      }
    }
    return counts;
  }, [detailRows, filteredRows, detailMealType, detailView]);

  const handleExportDetails = () => {
    if (!detailRows.length && !detailVisitors.length) return;
    let rows = [];
    if (detailView === "combined") {
      rows = [
        [
          "Employee ID",
          "Name",
          "Department",
          "Breakfast Selected",
          "Lunch Selected",
          "Dinner Selected",
        ],
        ...filteredRows.map((row) => [
          row.employeeId,
          row.name,
          row.department,
          row.breakfast?.selected || "",
          row.lunch?.selected || "",
          row.dinner?.selected || "",
        ]),
      ];
      if (detailVisitors.length) {
        rows.push([]);
        rows.push(["VISITORS"]);
        rows.push(["Name", "Phone", "Company", "Breakfast", "Lunch", "Dinner"]);
        rows.push(
          ...detailVisitors.map((visitor) => [
            visitor.name,
            visitor.phone || "",
            visitor.purpose || visitor.company || "",
            visitor.breakfast || "",
            visitor.lunch || "",
            visitor.dinner || "",
          ])
        );
      }
    } else {
      const key = detailMealType.toLowerCase();
      rows = [
        ["Employee ID", "Name", "Department", "Selected", "Request Status"],
        ...filteredRows.map((row) => [
          row.employeeId,
          row.name,
          row.department,
          row[key]?.selected || "",
          row[key]?.requestStatus || "",
        ]),
      ];
      if (detailVisitors.length) {
        rows.push([]);
        rows.push(["VISITORS"]);
        rows.push(["Name", "Phone", "Company", "Selected"]);
        rows.push(
          ...detailVisitors.map((visitor) => [
            visitor.name,
            visitor.phone || "",
            visitor.purpose || visitor.company || "",
            visitor[key] || "",
          ])
        );
      }
    }
    const csv = rows.map((row) => row.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `meal-report-details-${date}.csv`;
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
        <div className="pill-row">
          <button
            className={`pill ${mode === "summary" ? "active" : ""}`}
            onClick={() => setMode("summary")}
          >
            Summary
          </button>
          <button
            className={`pill ${mode === "details" ? "active" : ""}`}
            onClick={() => setMode("details")}
          >
            Details
          </button>
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
        {mode === "summary" ? (
          <>
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
          </>
        ) : (
          <>
            <div className="field">
              <label htmlFor="view">View</label>
              <select
                id="view"
                value={detailView}
                onChange={(event) => setDetailView(event.target.value)}
              >
                <option value="combined">Combined</option>
                <option value="meal">Single meal</option>
              </select>
            </div>
            {detailView === "meal" ? (
              <div className="field">
                <label htmlFor="meal">Meal</label>
                <select
                  id="meal"
                  value={detailMealType}
                  onChange={(event) => setDetailMealType(event.target.value)}
                >
                  <option value="BREAKFAST">Breakfast</option>
                  <option value="LUNCH">Lunch</option>
                  <option value="DINNER">Dinner</option>
                </select>
              </div>
            ) : null}
            <div className="field">
              <label htmlFor="search">Search (employeeId or name)</label>
              <input
                id="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </div>
            <button className="button" onClick={handleFetchDetails}>
              Get Details
            </button>
            <button
              className="button secondary"
              onClick={handleExportDetails}
              disabled={!detailRows.length}
            >
              Export Detail CSV
            </button>
          </>
        )}
      </div>

      {message ? <div className="message success">{message}</div> : null}
      {error ? <div className="message error">{error}</div> : null}

      {mode === "summary" && counts ? (
        <div className="card">
          <div className="report-header">
            <h2>Report Date</h2>
            <div className="report-date">{date}</div>
          </div>
        </div>
      ) : null}

      {mode === "summary" && counts ? (
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
            {approvedRequests ? (
              <div className="report-meta">Approved requests: {approvedRequests.BREAKFAST ?? 0}</div>
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
            {approvedRequests ? (
              <div className="report-meta">Approved requests: {approvedRequests.LUNCH ?? 0}</div>
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
            {approvedRequests ? (
              <div className="report-meta">Approved requests: {approvedRequests.DINNER ?? 0}</div>
            ) : null}
          </div>
        </div>
      ) : null}

      {mode === "details" ? (
        <div className="card">
          <div className="report-header">
            <h2>Details</h2>
            <div className="report-date">{date}</div>
          </div>
          <div className="count-bar">
            <div className="count-chip">
              Employees: {detailCounts.shownEmployees} shown / {detailCounts.totalEmployees} total
            </div>
            {detailView === "meal" ? (
              <>
                <div className="count-chip">YES: {detailCounts.meals[detailMealType].yes}</div>
                <div className="count-chip">NO: {detailCounts.meals[detailMealType].no}</div>
                <div className="count-chip">Not set: {detailCounts.meals[detailMealType].notSet}</div>
                {Object.keys(detailCounts.meals[detailMealType].requests).map((status) => (
                  <div className="count-chip" key={status}>
                    {status}: {detailCounts.meals[detailMealType].requests[status]}
                  </div>
                ))}
              </>
            ) : (
              <>
                {["BREAKFAST", "LUNCH", "DINNER"].map((meal) => (
                  <div className="count-chip" key={meal}>
                    {meal}: YES {detailCounts.meals[meal].yes} · NO {detailCounts.meals[meal].no} · Not set {detailCounts.meals[meal].notSet}
                  </div>
                ))}
              </>
            )}
          </div>
          {detailMeta ? (
            <div className="report-meta">
              Office open: {detailMeta.officeOpen ? "Yes" : "No"} · Breakfast:{" "}
              {detailMeta.serviceDay?.breakfastServed ? "Yes" : "No"} · Lunch:{" "}
              {detailMeta.serviceDay?.lunchServed ? "Yes" : "No"} · Dinner:{" "}
              {detailMeta.serviceDay?.dinnerServed ? "Yes" : "No"}
            </div>
          ) : null}
          {detailView === "combined" ? (
            <table className="report-table">
              <thead>
                <tr>
                  <th>Employee ID</th>
                  <th>Name</th>
                  <th>Department</th>
                  <th>Breakfast Selected</th>
                  <th>Lunch Selected</th>
                  <th>Dinner Selected</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => (
                  <tr key={row.employeeId}>
                    <td>{row.employeeId}</td>
                    <td>{row.name}</td>
                    <td>{row.department}</td>
                    <td>{formatSelected(row.breakfast)}</td>
                    <td>{formatSelected(row.lunch)}</td>
                    <td>{formatSelected(row.dinner)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <table className="report-table">
              <thead>
                <tr>
                  <th>Employee ID</th>
                  <th>Name</th>
                  <th>Department</th>
                  <th>Selected</th>
                  <th>Request Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row) => {
                  const key = detailMealType.toLowerCase();
                  const cell = row[key];
                  return (
                    <tr key={row.employeeId}>
                      <td>{row.employeeId}</td>
                      <td>{row.name}</td>
                      <td>{row.department}</td>
                      <td>{cell?.selected || ""}</td>
                      <td>{cell?.requestStatus || ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {detailVisitors.length ? (
            <div className="card">
              <h3>Visitors</h3>
              <table className="report-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Phone</th>
                    <th>Company</th>
                    {detailView === "combined" ? (
                      <>
                        <th>Breakfast</th>
                        <th>Lunch</th>
                        <th>Dinner</th>
                      </>
                    ) : (
                      <th>Selected</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {detailVisitors.map((visitor) => (
                    <tr key={visitor.id}>
                      <td>{visitor.name}</td>
                      <td>{visitor.phone || ""}</td>
                      <td>{visitor.purpose || visitor.company || ""}</td>
                      {detailView === "combined" ? (
                        <>
                          <td>{visitor.breakfast || ""}</td>
                          <td>{visitor.lunch || ""}</td>
                          <td>{visitor.dinner || ""}</td>
                        </>
                      ) : (
                        <td>{visitor[detailMealType.toLowerCase()] || ""}</td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
