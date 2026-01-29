import { useEffect, useMemo, useState } from "react";
import { adminGetAuditLogs, adminGetAuditMeta } from "../lib/api.js";

const pageSizeOptions = [25, 50, 100, 200];

function csvEscape(value) {
  if (value === null || value === undefined) return "";
  const stringValue = String(value);
  if (/[",\n\r]/.test(stringValue)) {
    return `"${stringValue.replace(/"/g, '""')}"`;
  }
  return stringValue;
}

function formatJson(value) {
  if (!value) return "";
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return String(value);
  }
}

function formatActor(actor) {
  if (!actor) return "System";
  const label = actor.employeeId ? `${actor.employeeId}` : "";
  const name = actor.name ? `${actor.name}` : "Unknown";
  return label ? `${name} (${label})` : name;
}

export default function AuditLog() {
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [action, setAction] = useState("");
  const [entity, setEntity] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [total, setTotal] = useState(0);
  const [items, setItems] = useState([]);
  const [meta, setMeta] = useState({ actions: [], entities: [] });
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const totalPages = useMemo(() => {
    if (!total || pageSize <= 0) return 1;
    return Math.max(1, Math.ceil(total / pageSize));
  }, [total, pageSize]);

  const loadMeta = async () => {
    try {
      const data = await adminGetAuditMeta();
      setMeta({
        actions: data?.actions || [],
        entities: data?.entities || [],
      });
    } catch (err) {
      setError(err.message || "Failed to load metadata");
    }
  };

  const loadLogs = async (overrides = {}) => {
    setMessage("");
    setError("");
    setLoading(true);
    const params = {
      page,
      pageSize,
      from: from || undefined,
      to: to || undefined,
      action: action || undefined,
      entity: entity || undefined,
      q: query || undefined,
      ...overrides,
    };
    try {
      const data = await adminGetAuditLogs(params);
      setItems(data?.items || []);
      setTotal(data?.total || 0);
      setPage(data?.page || params.page || 1);
      setPageSize(data?.pageSize || params.pageSize || 50);
      setMessage("Loaded");
    } catch (err) {
      setItems([]);
      setTotal(0);
      setError(err.message || "Failed to load audit logs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadMeta();
    loadLogs({ page: 1 });
  }, []);

  const handleSearch = () => {
    setPage(1);
    loadLogs({ page: 1 });
  };

  const handlePageChange = (nextPage) => {
    const safePage = Math.min(Math.max(nextPage, 1), totalPages);
    setPage(safePage);
    loadLogs({ page: safePage });
  };

  const handlePageSize = (value) => {
    setPageSize(value);
    setPage(1);
    loadLogs({ page: 1, pageSize: value });
  };

  const handleExport = () => {
    if (!items.length) return;
    const rows = [
      [
        "Timestamp",
        "Action",
        "Entity",
        "Entity ID",
        "Actor Name",
        "Actor Employee ID",
        "Actor Role",
        "Reason",
        "Before",
        "After",
      ],
      ...items.map((item) => [
        item.createdAt,
        item.action,
        item.entity,
        item.entityId || "",
        item.actor?.name || "",
        item.actor?.employeeId || "",
        item.actor?.role || "",
        item.reason || "",
        item.before || "",
        item.after || "",
      ]),
    ];

    const csv = rows
      .map((row) => row.map((cell) => csvEscape(cell)).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `audit-log-page-${page}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="app">
      <div className="card">
        <h2>Audit Log</h2>
        <div className="grid">
          <div className="field">
            <label htmlFor="fromDate">From (YYYY-MM-DD)</label>
            <input
              id="fromDate"
              type="date"
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="toDate">To (YYYY-MM-DD)</label>
            <input
              id="toDate"
              type="date"
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="action">Action</label>
            <select
              id="action"
              value={action}
              onChange={(event) => setAction(event.target.value)}
            >
              <option value="">All actions</option>
              {meta.actions.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="entity">Entity</label>
            <select
              id="entity"
              value={entity}
              onChange={(event) => setEntity(event.target.value)}
            >
              <option value="">All entities</option>
              {meta.entities.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="query">Search</label>
            <input
              id="query"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Reason, entity ID, action, actor..."
            />
          </div>
        </div>
        <div className="list-controls">
          <button className="button" onClick={handleSearch} disabled={loading}>
            {loading ? "Loading..." : "Search"}
          </button>
          <button className="button secondary" onClick={handleExport} disabled={!items.length}>
            Export CSV (page)
          </button>
        </div>
        {message ? <div className="message success">{message}</div> : null}
        {error ? <div className="message error">{error}</div> : null}
      </div>

      <div className="card">
        <div className="list-controls">
          <div className="muted">
            Showing {items.length} of {total} (page {page} of {totalPages})
          </div>
          <div className="list-controls">
            <label className="toggle">
              Page size
              <select value={pageSize} onChange={(event) => handlePageSize(Number(event.target.value))}>
                {pageSizeOptions.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="button secondary"
              onClick={() => handlePageChange(page - 1)}
              disabled={page <= 1 || loading}
            >
              Prev
            </button>
            <button
              className="button secondary"
              onClick={() => handlePageChange(page + 1)}
              disabled={page >= totalPages || loading}
            >
              Next
            </button>
          </div>
        </div>
        <div className="list">
          {items.length === 0 ? <div className="muted">No audit logs found.</div> : null}
          {items.map((item) => (
            <details key={item.id} className="audit-row">
              <summary>
                <span>{new Date(item.createdAt).toLocaleString()}</span>
                <span>{item.action}</span>
                <span>{item.entity}</span>
                <span>{formatActor(item.actor)}</span>
              </summary>
              <div className="audit-meta">
                <div><strong>Entity ID:</strong> {item.entityId || "-"}</div>
                <div><strong>Reason:</strong> {item.reason || "-"}</div>
              </div>
              <div className="audit-json-grid">
                <div>
                  <div className="audit-label">Before</div>
                  <pre className="audit-json">{formatJson(item.before)}</pre>
                </div>
                <div>
                  <div className="audit-label">After</div>
                  <pre className="audit-json">{formatJson(item.after)}</pre>
                </div>
              </div>
            </details>
          ))}
        </div>
      </div>
    </div>
  );
}
