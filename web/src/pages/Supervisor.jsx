import { useEffect, useMemo, useState } from "react";
import {
  adminGetMasterData,
  adminListUsers,
  createVisitor,
  getSession,
  getVisitorMeals,
  listUsers,
  searchVisitors,
  setStaffChoice,
  setGroundStaffBulk,
  setVisitorMeals,
} from "../lib/api.js";
import { todayStr } from "../lib/date.js";

const mealTypes = ["BREAKFAST", "LUNCH", "DINNER"];
const UNASSIGNED_LABEL = "Unassigned";

export default function Supervisor() {
  const [mode, setMode] = useState("employee");
  const [users, setUsers] = useState([]);
  const [adminUsers, setAdminUsers] = useState([]);
  const [employeeId, setEmployeeId] = useState("");
  const [date, setDate] = useState(todayStr());
  const [bulkUseRange, setBulkUseRange] = useState(false);
  const [bulkFrom, setBulkFrom] = useState(todayStr());
  const [bulkTo, setBulkTo] = useState(todayStr());
  const [bulkMeals, setBulkMeals] = useState([...mealTypes]);
  const [bulkWantMeal, setBulkWantMeal] = useState("YES");
  const [scopeSite, setScopeSite] = useState("");
  const [scopeSupervisor, setScopeSupervisor] = useState("");
  const [siteOptions, setSiteOptions] = useState([]);
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [bulkErrorDetails, setBulkErrorDetails] = useState(null);
  const [bulkWarningDetails, setBulkWarningDetails] = useState(null);
  const [showMembers, setShowMembers] = useState(false);
  const [copyStatus, setCopyStatus] = useState("");
  const [skipNotServed, setSkipNotServed] = useState(true);
  const [skipAfterCutoff, setSkipAfterCutoff] = useState(true);
  const [forceNotServed, setForceNotServed] = useState(false);
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
  const sessionUser = getSession()?.user;
  const role = sessionUser?.role;
  const isHr = role === "HR_ADMIN" || role === "SUPER_ADMIN";
  const isSupervisorRole = role === "SUPERVISOR";
  const isAdminScopeRole = role === "HR_ADMIN" || role === "SUPER_ADMIN";
  const currentSite = sessionUser?.site || "";
  const currentEmployeeId = sessionUser?.employeeId || "";
  const currentName = sessionUser?.name || "";
  const isUnassignedValue = (value) => value?.trim().toLowerCase() === UNASSIGNED_LABEL.toLowerCase();

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
    if (!isAdminScopeRole) return;
    let active = true;
    adminListUsers()
      .then((data) => {
        if (!active) return;
        setAdminUsers(data || []);
      })
      .catch((err) => {
        if (!active) return;
        setError(err.message || "Failed to load users");
      });
    return () => {
      active = false;
    };
  }, [isAdminScopeRole]);

  useEffect(() => {
    if (!isAdminScopeRole) return;
    let active = true;
    adminGetMasterData()
      .then((data) => {
        if (!active) return;
        const sites = (data?.sites || []).filter((site) => !isUnassignedValue(site));
        setSiteOptions(sites);
      })
      .catch(() => {
        if (!active) return;
        setSiteOptions([]);
      });
    return () => {
      active = false;
    };
  }, [isAdminScopeRole]);

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

  useEffect(() => {
    if (mode === "visitor") return;
    setVisitorQuery("");
    setVisitorResults([]);
    setSelectedVisitor(null);
    setVisitorForm({ name: "", phone: "", company: "" });
    setVisitorMealsState({
      BREAKFAST: null,
      LUNCH: null,
      DINNER: null,
    });
  }, [mode]);

  useEffect(() => {
    if (mode === "ground") return;
    setBulkErrorDetails(null);
    setBulkWarningDetails(null);
    setShowMembers(false);
    setCopyStatus("");
  }, [mode]);

  useEffect(() => {
    if (!showMembers) return;
    setCopyStatus("");
  }, [showMembers]);

  useEffect(() => {
    if (!isAdminScopeRole) return;
    setScopeSupervisor("");
  }, [scopeSite, isAdminScopeRole]);

  const availableSites = useMemo(() => {
    if (siteOptions.length) return siteOptions;
    const set = new Set();
    for (const user of adminUsers) {
      if (!user.site || isUnassignedValue(user.site)) continue;
      set.add(user.site);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [adminUsers, siteOptions]);

  useEffect(() => {
    if (!isAdminScopeRole) return;
    if (scopeSite && !availableSites.includes(scopeSite)) {
      setScopeSite("");
    }
  }, [availableSites, isAdminScopeRole, scopeSite]);

  const supervisorOptions = useMemo(() => {
    if (!isAdminScopeRole || !scopeSite) return [];
    return adminUsers
      .filter((user) => user.role === "SUPERVISOR" && user.active && user.site === scopeSite)
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
  }, [adminUsers, isAdminScopeRole, scopeSite]);

  const scopedGroundStaff = useMemo(() => {
    if (mode !== "ground") return [];
    if (isSupervisorRole) {
      return users.filter((user) => user.role === "GROUND_STAFF");
    }
    if (isAdminScopeRole) {
      if (!scopeSite || isUnassignedValue(scopeSite)) return [];
      let list = adminUsers.filter(
        (user) => user.role === "GROUND_STAFF" && user.active && user.site === scopeSite
      );
      if (scopeSupervisor) {
        list = list.filter((user) => user.supervisorEmployeeId === scopeSupervisor);
      }
      return list;
    }
    return users.filter((user) => user.role === "GROUND_STAFF");
  }, [adminUsers, isAdminScopeRole, isSupervisorRole, mode, scopeSite, scopeSupervisor, users]);
  const groundStaffCount = scopedGroundStaff.length;
  const memberLines = useMemo(
    () =>
      scopedGroundStaff.map(
        (member) => `${member.employeeId} - ${member.name || "Ground Staff"}`
      ),
    [scopedGroundStaff]
  );

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

  const toggleBulkMeal = (mealType) => {
    setBulkMeals((prev) =>
      prev.includes(mealType) ? prev.filter((item) => item !== mealType) : [...prev, mealType]
    );
  };

  const handleBulkSubmit = async () => {
    setMessage("");
    setError("");
    setBulkErrorDetails(null);
    setBulkWarningDetails(null);
    if (!bulkMeals.length) {
      setError("Select at least one meal");
      return;
    }
    if (forceNotServed && !reason.trim()) {
      setError("Override reason required to force not served meals.");
      return;
    }
    if (!skipAfterCutoff && !reason.trim()) {
      setError("Override reason required to include days past cutoff.");
      return;
    }
    if (isSupervisorRole && (!currentSite || isUnassignedValue(currentSite))) {
      setError("Your site is unassigned. Bulk apply is disabled.");
      return;
    }
    if (isAdminScopeRole) {
      if (!scopeSite || isUnassignedValue(scopeSite)) {
        setError("Select a site to continue.");
        return;
      }
    }
    const from = bulkUseRange ? bulkFrom : date;
    const to = bulkUseRange ? bulkTo : date;
    try {
      setCopyStatus("");
      const payload = {
        from,
        to,
        meals: bulkMeals,
        wantMeal: bulkWantMeal === "YES",
        overrideReason: reason || undefined,
        skipNotServed,
        skipAfterCutoff,
        forceNotServed,
      };
      if (isAdminScopeRole) {
        payload.site = scopeSite;
        if (scopeSupervisor) {
          payload.supervisorEmployeeId = scopeSupervisor;
        }
      }
      const result = await setGroundStaffBulk(payload);
      if (result?.skipped?.blocked?.length || result?.skipped?.violations?.length) {
        setBulkWarningDetails({
          blocked: result.skipped.blocked || [],
          violations: result.skipped.violations || [],
        });
      }
      const scopeLabel = result?.scope?.site
        ? ` (Site: ${result.scope.site}${
            result.scope.supervisorEmployeeId ? `, Supervisor: ${result.scope.supervisorEmployeeId}` : ""
          })`
        : "";
      setMessage(
        `Bulk update saved for ${result?.affectedUsers ?? 0} ground staff${scopeLabel}`
      );
    } catch (err) {
      setError(err.message || "Failed");
      const details = err?.details?.details ?? err?.details;
      const blocked = details?.blocked ?? details?.skipped?.blocked;
      const violations = details?.violations ?? details?.skipped?.violations;
      if (blocked || violations) {
        setBulkErrorDetails({
          blocked: Array.isArray(blocked) ? blocked : [],
          violations: Array.isArray(violations) ? violations : [],
        });
      }
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
          <button
            className={`pill ${mode === "ground" ? "active" : ""}`}
            onClick={() => setMode("ground")}
            type="button"
          >
            Ground Staff Group
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
        ) : null}
        {mode === "visitor" ? (
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
        ) : null}
        {mode === "ground" ? (
          <>
            <div className="card">
              <h3>Target Scope</h3>
              {isSupervisorRole ? (
                <>
                  <div className="row-status">Target: Your assigned ground staff</div>
                  <div className="row-status">Site: {currentSite || UNASSIGNED_LABEL}</div>
                  <div className="row-status">
                    Supervisor:{" "}
                    {currentName
                      ? `${currentName} (${currentEmployeeId || "Unknown"})`
                      : currentEmployeeId || "Unknown"}
                  </div>
                  <div className="row-status">Count: {groundStaffCount}</div>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => setShowMembers(true)}
                    disabled={!groundStaffCount}
                  >
                    View members ({groundStaffCount})
                  </button>
                  {!currentSite || isUnassignedValue(currentSite) ? (
                    <div className="message error">Your site is unassigned. Bulk apply is disabled.</div>
                  ) : null}
                </>
              ) : isAdminScopeRole ? (
                <>
                  <div className="field">
                    <label htmlFor="scopeSite">Site (required)</label>
                    <select
                      id="scopeSite"
                      value={scopeSite}
                      onChange={(event) => setScopeSite(event.target.value)}
                    >
                      <option value="">Select site</option>
                      {availableSites.map((site) => (
                        <option key={site} value={site}>
                          {site}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="scopeSupervisor">Supervisor (optional)</label>
                    <select
                      id="scopeSupervisor"
                      value={scopeSupervisor}
                      onChange={(event) => setScopeSupervisor(event.target.value)}
                      disabled={!scopeSite}
                    >
                      <option value="">All supervisors in this site</option>
                      {supervisorOptions.map((supervisor) => (
                        <option key={supervisor.employeeId} value={supervisor.employeeId}>
                          {supervisor.name
                            ? `${supervisor.name} (${supervisor.employeeId})`
                            : supervisor.employeeId}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="row-status">
                    Target:{" "}
                    {scopeSite
                      ? `Ground Staff in ${scopeSite}${
                          scopeSupervisor ? ` (Supervisor: ${scopeSupervisor})` : " (All supervisors)"
                        }`
                      : "Select a site"}
                  </div>
                  <div className="row-status">Count: {scopeSite ? groundStaffCount : 0}</div>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => setShowMembers(true)}
                    disabled={!scopeSite || !groundStaffCount}
                  >
                    View members ({groundStaffCount})
                  </button>
                </>
              ) : null}
            </div>
            <div className="field">
              <label>
                <input
                  type="checkbox"
                  checked={bulkUseRange}
                  onChange={(event) => setBulkUseRange(event.target.checked)}
                />{" "}
                Use date range
              </label>
            </div>
            {bulkUseRange ? (
              <div className="row">
                <div className="field">
                  <label htmlFor="from">From</label>
                  <input
                    id="from"
                    type="date"
                    value={bulkFrom}
                    onChange={(event) => setBulkFrom(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="to">To</label>
                  <input
                    id="to"
                    type="date"
                    value={bulkTo}
                    onChange={(event) => setBulkTo(event.target.value)}
                  />
                </div>
              </div>
            ) : (
              <div className="field">
                <label htmlFor="date">Date</label>
                <input
                  id="date"
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </div>
            )}
            <div className="field">
              <label>Meals</label>
              <div className="pill-row">
                {mealTypes.map((mealType) => (
                  <button
                    key={mealType}
                    type="button"
                    className={`pill ${bulkMeals.includes(mealType) ? "active" : ""}`}
                    onClick={() => toggleBulkMeal(mealType)}
                  >
                    {mealType}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Apply selection</label>
              <div className="button-group">
                <button
                  type="button"
                  className={`big-button yes ${bulkWantMeal === "YES" ? "btn-selected" : ""}`.trim()}
                  onClick={() => setBulkWantMeal("YES")}
                >
                  YES
                </button>
                <button
                  type="button"
                  className={`big-button no ${bulkWantMeal === "NO" ? "btn-selected" : ""}`.trim()}
                  onClick={() => setBulkWantMeal("NO")}
                >
                  NO
                </button>
              </div>
            </div>
            <div className="field checkbox">
              <label>
                <input
                  type="checkbox"
                  checked={skipNotServed}
                  onChange={(event) => setSkipNotServed(event.target.checked)}
                />{" "}
                Skip days where meal is not served
              </label>
            </div>
            <div className="field checkbox">
              <label>
                <input
                  type="checkbox"
                  checked={skipAfterCutoff}
                  onChange={(event) => setSkipAfterCutoff(event.target.checked)}
                />{" "}
                Skip days where cutoff is passed
              </label>
            </div>
            <div className="field checkbox">
              <label>
                <input
                  type="checkbox"
                  checked={forceNotServed}
                  onChange={(event) => setForceNotServed(event.target.checked)}
                />{" "}
                Force include days even if meal not served (requires override reason)
              </label>
            </div>
            <div className="row-status">This will apply to {groundStaffCount} ground staff</div>
          </>
        ) : (
          <div className="field">
            <label htmlFor="date">Date</label>
            <input
              id="date"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
        )}
        {mode === "ground" || isHr ? (
          <div className="field">
            <label htmlFor="reason">Override reason (required after cutoff)</label>
            <input
              id="reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          </div>
        ) : null}
        {mode !== "ground"
          ? mealTypes.map((mealType) => (
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
                    onClick={() =>
                      mode === "employee" ? handleChoice(mealType, true) : handleVisitorMeal(mealType, "YES")
                    }
                    disabled={mode === "employee" ? !employeeId : !selectedVisitor}
                  >
                    YES
                  </button>
                  <button
                    className={`big-button no ${
                      mode === "visitor" && visitorMeals[mealType] === "NO" ? "btn-selected" : ""
                    }`.trim()}
                    onClick={() =>
                      mode === "employee" ? handleChoice(mealType, false) : handleVisitorMeal(mealType, "NO")
                    }
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
            ))
          : null}
        {mode === "visitor" ? (
          <button className="button" type="button" onClick={handleSaveVisitorMeals} disabled={!selectedVisitor}>
            Save visitor meals
          </button>
        ) : null}
        {mode === "ground" ? (
          <button
            className="button"
            type="button"
            onClick={handleBulkSubmit}
            disabled={
              !groundStaffCount || (isAdminScopeRole && (!scopeSite || isUnassignedValue(scopeSite)))
            }
          >
            Apply to ground staff
          </button>
        ) : null}
      </div>
      {message ? <div className="message success">{message}</div> : null}
      {bulkWarningDetails ? (
        <div className="message warning">
          <div>Some days were skipped.</div>
          {bulkWarningDetails.blocked?.length ? (
            <div>
              {bulkWarningDetails.blocked.map((item, index) => (
                <div key={`${item.date}-${item.mealType}-${index}`}>
                  Meal not served: {item.date} ({item.mealType}){" "}
                  {item.reason ? `- ${item.reason.replaceAll("_", " ").toLowerCase()}` : ""}
                </div>
              ))}
            </div>
          ) : null}
          {bulkWarningDetails.violations?.length ? (
            <div>
              {bulkWarningDetails.violations.map((item, index) => (
                <div key={`${item.date}-${item.mealType}-${index}`}>
                  Cutoff passed: {item.date} ({item.mealType}) cutoff {item.cutoff}{" "}
                  {item.timezone ? `(${item.timezone})` : ""}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
      {error ? (
        <div className="message error">
          <div>{error}</div>
          {mode === "ground" && bulkErrorDetails ? (
            <div>
              {bulkErrorDetails.blocked?.length ? (
                <div>
                  {bulkErrorDetails.blocked.map((item, index) => (
                    <div key={`${item.date}-${item.mealType}-${index}`}>
                      Meal not served: {item.date} ({item.mealType})
                      {item.reason ? ` - ${item.reason.replaceAll("_", " ").toLowerCase()}` : ""}
                    </div>
                  ))}
                </div>
              ) : null}
              {bulkErrorDetails.violations?.length ? (
                <div>
                  {bulkErrorDetails.violations.map((item, index) => (
                    <div key={`${item.date}-${item.mealType}-${index}`}>
                      Cutoff passed: {item.date} ({item.mealType}) cutoff {item.cutoff}{" "}
                      {item.timezone ? `(${item.timezone})` : ""}
                    </div>
                  ))}
                </div>
              ) : null}
              <div className="muted">Check Calendar/Defaults → Service Days.</div>
            </div>
          ) : null}
        </div>
      ) : null}
      {showMembers ? (
        <div className="modal-backdrop" onClick={() => setShowMembers(false)}>
          <div className="modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <h3>Ground Staff Members ({groundStaffCount})</h3>
              <button className="button secondary" type="button" onClick={() => setShowMembers(false)}>
                Close
              </button>
            </div>
            {scopedGroundStaff.length ? (
              <div className="list modal-list">
                {scopedGroundStaff.map((member) => (
                  <div className="list-row" key={member.employeeId}>
                    <div>
                      <div className="row-title">{member.name || "Ground Staff"}</div>
                      <div className="row-status">{member.employeeId}</div>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="muted">No ground staff in scope.</div>
            )}
            <div className="modal-actions">
              <button
                className="button"
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(memberLines.join("\n"));
                    setCopyStatus("Copied list to clipboard.");
                  } catch (err) {
                    setCopyStatus("Unable to copy list.");
                  }
                }}
                disabled={!scopedGroundStaff.length}
              >
                Copy list
              </button>
              {copyStatus ? <div className="muted">{copyStatus}</div> : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
