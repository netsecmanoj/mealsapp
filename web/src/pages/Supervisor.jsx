import { useEffect, useMemo, useState } from "react";
import {
  adminGetMasterData,
  adminListUsers,
  adminListVisitors,
  adminDeleteVisitors,
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
  const [selectedVisitors, setSelectedVisitors] = useState([]);
  const [visitorForm, setVisitorForm] = useState({ name: "", phone: "", purpose: "" });
  const [visitorMeals, setVisitorMealsState] = useState({
    BREAKFAST: null,
    LUNCH: null,
    DINNER: null,
  });
  const [visitorSuccess, setVisitorSuccess] = useState("");
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddPrefix, setQuickAddPrefix] = useState("Visitor");
  const [quickAddCount, setQuickAddCount] = useState(3);
  const [cleanupFrom, setCleanupFrom] = useState(() => {
    const date = new Date();
    date.setDate(date.getDate() - 7);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  });
  const [cleanupTo, setCleanupTo] = useState(todayStr());
  const [cleanupStatus, setCleanupStatus] = useState("unused");
  const [cleanupQuery, setCleanupQuery] = useState("");
  const [cleanupLimit, setCleanupLimit] = useState(500);
  const [cleanupItems, setCleanupItems] = useState([]);
  const [cleanupTotal, setCleanupTotal] = useState(0);
  const [cleanupSelectedIds, setCleanupSelectedIds] = useState([]);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupMessage, setCleanupMessage] = useState("");
  const [cleanupError, setCleanupError] = useState("");
  const [cleanupSkipped, setCleanupSkipped] = useState([]);
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
    if (mode !== "visitor") return;
    if (selectedVisitors.length !== 1) {
      setVisitorMealsState({ BREAKFAST: null, LUNCH: null, DINNER: null });
      return;
    }
    const visitor = selectedVisitors[0];
    getVisitorMeals(visitor.id, date)
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
  }, [mode, selectedVisitors, date]);

  useEffect(() => {
    if (mode === "visitor") return;
    setVisitorQuery("");
    setVisitorResults([]);
    setSelectedVisitors([]);
    setVisitorForm({ name: "", phone: "", purpose: "" });
    setVisitorMealsState({
      BREAKFAST: null,
      LUNCH: null,
      DINNER: null,
    });
    setVisitorSuccess("");
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
    if (!visitorSuccess) return;
    const timer = setTimeout(() => setVisitorSuccess(""), 3000);
    return () => clearTimeout(timer);
  }, [visitorSuccess]);

  const filteredEmployees = useMemo(() => {
    const query = employeeSearch.trim().toLowerCase();
    if (!query) return users;
    return users.filter(
      (user) =>
        user.name?.toLowerCase().includes(query) ||
        user.employeeId?.toLowerCase().includes(query)
    );
  }, [employeeSearch, users]);

  const selectedEmployee = useMemo(
    () => users.find((user) => user.employeeId === employeeId) || null,
    [employeeId, users]
  );

  const shownCount = filteredEmployees.length;
  const totalCount = users.length;

  const addSelectedVisitor = (visitor) => {
    setSelectedVisitors((current) => {
      if (current.some((item) => item.id === visitor.id)) return current;
      return [...current, visitor];
    });
  };

  const removeSelectedVisitor = (visitorId) => {
    setSelectedVisitors((current) => current.filter((visitor) => visitor.id !== visitorId));
  };

  const clearSelectedVisitors = () => {
    setSelectedVisitors([]);
  };

  const toggleSelectedVisitor = (visitor) => {
    setSelectedVisitors((current) => {
      if (current.some((item) => item.id === visitor.id)) {
        return current.filter((item) => item.id !== visitor.id);
      }
      return [...current, visitor];
    });
  };

  const isVisitorSelected = (visitorId) =>
    selectedVisitors.some((visitor) => visitor.id === visitorId);

  const getVisitorPurpose = (visitor) => visitor.purpose || visitor.company || "";

  const cleanupSelectedSet = useMemo(
    () => new Set(cleanupSelectedIds),
    [cleanupSelectedIds]
  );

  const toggleCleanupSelection = (id) => {
    setCleanupSelectedIds((current) => {
      if (current.includes(id)) {
        return current.filter((item) => item !== id);
      }
      return [...current, id];
    });
  };

  const clearCleanupSelection = () => {
    setCleanupSelectedIds([]);
  };

  const formatCreatedAt = (value) => {
    if (!value) return "";
    try {
      return new Date(value).toLocaleString();
    } catch {
      return String(value);
    }
  };

  const visitorName = visitorForm.name.trim();
  const visitorPhone = visitorForm.phone.trim();
  const visitorPhoneDigits = visitorPhone.replace(/\s+/g, "");
  const visitorPhoneValid = /^\d+$/.test(visitorPhoneDigits) && visitorPhoneDigits.length === 10;
  const visitorNameValid = visitorName.length > 0;
  const visitorFormValid = visitorNameValid && visitorPhoneValid;
  const safeQuickAddCount = Number.isFinite(quickAddCount) ? quickAddCount : 1;

  const generatePhone = () => {
    const tail = String(Date.now() + Math.floor(Math.random() * 1_000_000)).slice(-9);
    return `9${tail}`;
  };

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
    toggleSelectedVisitor(visitor);
  };

  const handleCreateVisitor = async () => {
    setMessage("");
    setError("");
    if (!visitorFormValid) {
      setError("Enter a valid name and 10-digit phone.");
      return;
    }
    try {
      const created = await createVisitor({
        ...visitorForm,
        phone: visitorPhoneDigits,
      });
      addSelectedVisitor(created);
      setVisitorQuery("");
      setVisitorResults([]);
      setVisitorSuccess("Visitor saved");
    } catch (err) {
      setError(err.message || "Failed to create visitor");
    }
  };

  const handleQuickAddVisitors = async () => {
    setMessage("");
    setError("");
    const count = Number(safeQuickAddCount) || 0;
    if (count < 1) {
      setError("Enter a valid visitor count.");
      return;
    }
    const created = [];
    let failures = 0;
    for (let index = 1; index <= Math.min(count, 50); index += 1) {
      let attempts = 0;
      let done = false;
      while (attempts < 5 && !done) {
        attempts += 1;
        const phone = generatePhone();
        try {
          const visitor = await createVisitor({
            name: `${quickAddPrefix.trim() || "Visitor"} #${index}`,
            phone,
            purpose: visitorForm.purpose?.trim() || undefined,
          });
          created.push(visitor);
          done = true;
        } catch (err) {
          const message = (err?.message || "").toLowerCase();
          if (message.includes("phone") || message.includes("exists") || message.includes("duplicate")) {
            continue;
          }
          failures += 1;
          done = true;
        }
      }
      if (!done) failures += 1;
    }
    created.forEach((visitor) => addSelectedVisitor(visitor));
    if (created.length) {
      setMessage(`Created and selected ${created.length} visitor${created.length === 1 ? "" : "s"}.`);
    }
    if (failures) {
      setError(`${created.length} succeeded, ${failures} failed.`);
    }
  };

  const handleVisitorMeal = (mealType, value) => {
    setVisitorMealsState((prev) => ({ ...prev, [mealType]: value }));
  };

  const handleSaveVisitorMeals = async () => {
    if (!selectedVisitors.length) {
      setError("Select at least one visitor");
      return;
    }
    setMessage("");
    setError("");
    try {
      let successCount = 0;
      let failureCount = 0;
      let firstError = "";
      for (const visitor of selectedVisitors) {
        try {
          await setVisitorMeals(visitor.id, {
            date,
            breakfast: visitorMeals.BREAKFAST,
            lunch: visitorMeals.LUNCH,
            dinner: visitorMeals.DINNER,
            overrideReason: reason || undefined,
          });
          successCount += 1;
        } catch (err) {
          failureCount += 1;
          if (!firstError) {
            firstError = err?.message || "Failed to save some visitors";
          }
        }
      }
      if (successCount) {
        setMessage(`Saved meals for ${successCount} visitor${successCount === 1 ? "" : "s"}.`);
      }
      if (failureCount) {
        setError(
          `${successCount} succeeded, ${failureCount} failed${firstError ? `: ${firstError}` : ""}`
        );
      }
    } catch (err) {
      setError(err.message || "Failed to save visitor meals");
    }
  };

  const loadCleanupVisitors = async () => {
    setCleanupLoading(true);
    setCleanupMessage("");
    setCleanupError("");
    setCleanupSkipped([]);
    try {
      const data = await adminListVisitors({
        from: cleanupFrom,
        to: cleanupTo,
        status: cleanupStatus,
        q: cleanupQuery,
        limit: cleanupLimit,
      });
      setCleanupItems(data?.items || []);
      setCleanupTotal(typeof data?.total === "number" ? data.total : (data?.items || []).length);
      setCleanupSelectedIds([]);
    } catch (err) {
      setCleanupError(err.message || "Failed to load visitors");
    } finally {
      setCleanupLoading(false);
    }
  };

  const handleDeleteSelectedVisitors = async () => {
    if (!cleanupSelectedIds.length) return;
    setCleanupMessage("");
    setCleanupError("");
    setCleanupSkipped([]);
    try {
      const result = await adminDeleteVisitors({
        ids: cleanupSelectedIds,
        mode: "unusedOnly",
        reason: "cleanup",
      });
      setCleanupMessage(`Deleted ${result?.deleted?.length || 0}, skipped ${result?.skipped?.length || 0}`);
      setCleanupSkipped(result?.skipped || []);
      await loadCleanupVisitors();
    } catch (err) {
      setCleanupError(err.message || "Failed to delete visitors");
    }
  };

  const handleDeleteAllUnused = async () => {
    setCleanupMessage("");
    setCleanupError("");
    setCleanupSkipped([]);
    if (cleanupStatus !== "unused") {
      setCleanupError("Set status to Unused to delete all in range.");
      return;
    }
    const warning =
      cleanupItems.length < cleanupTotal
        ? " Only loaded items will be deleted. Increase limit or narrow date range to delete all."
        : "";
    const confirmText = `Delete all UNUSED visitors created between ${cleanupFrom} and ${cleanupTo}? This cannot be undone.${warning}`;
    if (!window.confirm(confirmText)) return;
    const ids = cleanupItems.filter((item) => !item.mealsSaved).map((item) => item.id);
    if (!ids.length) {
      setCleanupMessage("No unused visitors found in this range.");
      return;
    }
    try {
      const result = await adminDeleteVisitors({
        ids,
        mode: "unusedOnly",
        reason: "cleanup",
      });
      setCleanupMessage(`Deleted ${result?.deleted?.length || 0}, skipped ${result?.skipped?.length || 0}`);
      setCleanupSkipped(result?.skipped || []);
      await loadCleanupVisitors();
    } catch (err) {
      setCleanupError(err.message || "Failed to delete visitors");
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
          <>
            <div className="field">
              <label htmlFor="employeeSearch">Search employee</label>
              <input
                id="employeeSearch"
                value={employeeSearch}
                onChange={(event) => setEmployeeSearch(event.target.value)}
                placeholder="Type name or employee ID"
              />
              <div className="list-controls">
                <button
                  className="button secondary"
                  type="button"
                  onClick={() => setEmployeeSearch("")}
                  disabled={!employeeSearch}
                >
                  Clear
                </button>
                <div className="muted">Showing {shownCount} of {totalCount} employees</div>
              </div>
            </div>
            {selectedEmployee &&
            employeeSearch.trim() &&
            !filteredEmployees.some((user) => user.employeeId === selectedEmployee.employeeId) ? (
              <div className="card compact">
                <div className="row-title">Selected</div>
                <div className="picker-item selected">
                  <div>
                    <div className="row-title">
                      {selectedEmployee.name} ({selectedEmployee.employeeId})
                    </div>
                    {selectedEmployee.dept || selectedEmployee.site ? (
                      <div className="row-status">
                        {[selectedEmployee.dept, selectedEmployee.site].filter(Boolean).join(" · ")}
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
            <div className="picker-list">
              {filteredEmployees.map((user) => (
                <button
                  key={user.employeeId}
                  type="button"
                  className={`picker-item ${user.employeeId === employeeId ? "selected" : ""}`}
                  onClick={() => setEmployeeId(user.employeeId)}
                >
                  <div>
                    <div className="row-title">
                      {user.name} ({user.employeeId})
                    </div>
                    {user.dept || user.site ? (
                      <div className="row-status">
                        {[user.dept, user.site].filter(Boolean).join(" · ")}
                      </div>
                    ) : null}
                  </div>
                </button>
              ))}
              {!filteredEmployees.length ? <div className="muted">No employees found.</div> : null}
            </div>
          </>
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
            {visitorQuery.trim() && visitorResults.length ? (
              <div className="picker-list">
                {visitorResults.map((visitor) => {
                  const checked = isVisitorSelected(visitor.id);
                  return (
                    <label className={`picker-item ${checked ? "selected" : ""}`} key={visitor.id}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => handleSelectVisitor(visitor)}
                      />
                      <div>
                        <div className="row-title">{visitor.name}</div>
                        <div className="row-status">
                          {visitor.phone || "No phone"} {getVisitorPurpose(visitor) ? `· ${getVisitorPurpose(visitor)}` : ""}
                        </div>
                      </div>
                    </label>
                  );
                })}
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
                {!visitorNameValid ? <div className="muted">Name is required.</div> : null}
              </div>
              <div className="field">
                <label htmlFor="visitorPhone">Phone</label>
                <input
                  id="visitorPhone"
                  value={visitorForm.phone}
                  onChange={(event) => setVisitorForm((prev) => ({ ...prev, phone: event.target.value }))}
                />
                {!visitorPhoneValid ? (
                  <div className="muted">Enter a valid 10-digit phone number.</div>
                ) : null}
              </div>
              <div className="field">
                <label htmlFor="visitorCompany">Purpose of visit</label>
                <input
                  id="visitorCompany"
                  value={visitorForm.purpose}
                  onChange={(event) => setVisitorForm((prev) => ({ ...prev, purpose: event.target.value }))}
                />
              </div>
              <button className="button" type="button" onClick={handleCreateVisitor} disabled={!visitorFormValid}>
                Save visitor
              </button>
              {visitorSuccess ? <div className="message success">{visitorSuccess}</div> : null}
            </div>
            <details className="card" open={quickAddOpen} onToggle={(event) => setQuickAddOpen(event.target.open)}>
              <summary>Quick add multiple visitors</summary>
              <div className="field">
                <label htmlFor="quickPrefix">Name prefix</label>
                <input
                  id="quickPrefix"
                  value={quickAddPrefix}
                  onChange={(event) => setQuickAddPrefix(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="quickPurpose">Purpose of visit</label>
                <input
                  id="quickPurpose"
                  value={visitorForm.purpose}
                  onChange={(event) => setVisitorForm((prev) => ({ ...prev, purpose: event.target.value }))}
                />
              </div>
              <div className="field">
                <label htmlFor="quickCount">Count</label>
                <div className="list-controls">
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => setQuickAddCount((prev) => Math.max(1, prev - 1))}
                  >
                    -
                  </button>
                <input
                  id="quickCount"
                  type="number"
                  min="1"
                  max="50"
                  value={Number.isFinite(quickAddCount) ? quickAddCount : ""}
                  onChange={(event) => setQuickAddCount(Number(event.target.value))}
                />
                  <button
                    className="button secondary"
                    type="button"
                    onClick={() => setQuickAddCount((prev) => Math.min(50, prev + 1))}
                  >
                    +
                  </button>
                </div>
              </div>
              <button className="button" type="button" onClick={handleQuickAddVisitors}>
                Create & select {Math.min(50, Math.max(1, safeQuickAddCount))} visitors
              </button>
            </details>
            <div className="card">
              <div className="header">
                <h3>Selected visitors</h3>
                <button
                  className="button secondary"
                  type="button"
                  onClick={clearSelectedVisitors}
                  disabled={!selectedVisitors.length}
                >
                  Clear all
                </button>
              </div>
              {selectedVisitors.length ? (
                <div className="list">
                  {selectedVisitors.map((visitor) => (
                    <div className="list-row" key={visitor.id}>
                      <div>
                        <div className="row-title">
                          {visitor.name} {visitor.phone ? `(${visitor.phone})` : ""}
                        </div>
                        {getVisitorPurpose(visitor) ? (
                          <div className="row-status">{getVisitorPurpose(visitor)}</div>
                        ) : null}
                      </div>
                      <div className="list-controls">
                        <button
                          className="button secondary"
                          type="button"
                          onClick={() => removeSelectedVisitor(visitor.id)}
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="muted">No visitors selected.</div>
              )}
            </div>
            {isHr ? (
              <details className="card">
                <summary>Cleanup visitors (Admin)</summary>
                <div className="field">
                  <label htmlFor="cleanupFrom">Created from</label>
                  <input
                    id="cleanupFrom"
                    type="date"
                    value={cleanupFrom}
                    onChange={(event) => setCleanupFrom(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="cleanupTo">Created to</label>
                  <input
                    id="cleanupTo"
                    type="date"
                    value={cleanupTo}
                    onChange={(event) => setCleanupTo(event.target.value)}
                  />
                </div>
                <div className="field">
                  <label htmlFor="cleanupStatus">Status</label>
                  <select
                    id="cleanupStatus"
                    value={cleanupStatus}
                    onChange={(event) => setCleanupStatus(event.target.value)}
                  >
                    <option value="unused">Unused</option>
                    <option value="used">Used</option>
                    <option value="all">All</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="cleanupQuery">Search</label>
                  <input
                    id="cleanupQuery"
                    value={cleanupQuery}
                    onChange={(event) => setCleanupQuery(event.target.value)}
                    placeholder="Search name / phone / purpose"
                  />
                </div>
                <div className="list-controls">
                  <button className="button" type="button" onClick={loadCleanupVisitors} disabled={cleanupLoading}>
                    {cleanupLoading ? "Loading..." : "Load"}
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={clearCleanupSelection}
                    disabled={!cleanupSelectedIds.length}
                  >
                    Clear selection
                  </button>
                  <div className="muted">
                    Showing {cleanupItems.length} of {cleanupTotal} visitors (status={cleanupStatus}, limit={cleanupLimit})
                  </div>
                  {cleanupItems.length < cleanupTotal ? (
                    <div className="muted">
                      Only loaded items will be deleted by “Delete ALL unused in range”.
                    </div>
                  ) : null}
                </div>
                {cleanupItems.length ? (
                  <div className="list">
                    {cleanupItems.map((visitor) => (
                      <div className="list-row" key={visitor.id}>
                        <div className="list-controls">
                          <input
                            type="checkbox"
                            checked={cleanupSelectedSet.has(visitor.id)}
                            onChange={() => toggleCleanupSelection(visitor.id)}
                          />
                        </div>
                        <div className="list-main">
                          <div className="row-title">{visitor.name}</div>
                          <div className="row-status">
                            {visitor.phone || "No phone"} {getVisitorPurpose(visitor) ? `· ${getVisitorPurpose(visitor)}` : ""}
                          </div>
                          <div className="row-status">
                            Created: {formatCreatedAt(visitor.createdAt)}
                          </div>
                          <div className="row-status">
                            Meals saved: {visitor.mealsSaved ? "Yes" : "No"}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="muted">No visitors loaded.</div>
                )}
                <div className="list-controls">
                  <button
                    className="button"
                    type="button"
                    onClick={handleDeleteSelectedVisitors}
                    disabled={!cleanupSelectedIds.length}
                  >
                    Delete selected (unused only)
                  </button>
                  <button
                    className="button secondary"
                    type="button"
                    onClick={handleDeleteAllUnused}
                    disabled={cleanupStatus !== "unused" || !cleanupItems.length}
                  >
                    Delete ALL unused in range
                  </button>
                </div>
                {cleanupMessage ? <div className="message success">{cleanupMessage}</div> : null}
                {cleanupError ? <div className="message error">{cleanupError}</div> : null}
                {cleanupSkipped.length ? (
                  <div className="message warning">
                    {cleanupSkipped.map((item) => (
                      <div key={item.id}>
                        {item.name} skipped: {item.reason}
                      </div>
                    ))}
                  </div>
                ) : null}
              </details>
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
          ? (
              <>
                {mode === "visitor" ? (
                  <div className="row">
                    <div className="row-left">
                      <div className="row-title">All meals</div>
                    </div>
                    <div className="button-group">
                      <button
                        className="big-button yes"
                        type="button"
                        onClick={() => {
                          setVisitorMealsState({
                            BREAKFAST: "YES",
                            LUNCH: "YES",
                            DINNER: "YES",
                          });
                        }}
                        disabled={!selectedVisitors.length}
                      >
                        YES
                      </button>
                      <button
                        className="big-button no"
                        type="button"
                        onClick={() => {
                          setVisitorMealsState({
                            BREAKFAST: "NO",
                            LUNCH: "NO",
                            DINNER: "NO",
                          });
                        }}
                        disabled={!selectedVisitors.length}
                      >
                        NO
                      </button>
                      <button
                        className="button secondary"
                        type="button"
                        onClick={() => {
                          setVisitorMealsState({
                            BREAKFAST: null,
                            LUNCH: null,
                            DINNER: null,
                          });
                        }}
                        disabled={!selectedVisitors.length}
                      >
                        Clear
                      </button>
                    </div>
                  </div>
                ) : null}
                {mealTypes.map((mealType) => (
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
                        disabled={mode === "employee" ? !employeeId : !selectedVisitors.length}
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
                        disabled={mode === "employee" ? !employeeId : !selectedVisitors.length}
                      >
                        NO
                      </button>
                      {mode === "visitor" ? (
                        <button
                          className="button secondary"
                          type="button"
                          onClick={() => handleVisitorMeal(mealType, null)}
                          disabled={!selectedVisitors.length}
                        >
                          Clear
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </>
            )
          : null}
        {mode === "visitor" ? (
          <>
            <div className="muted">Selected: {selectedVisitors.length} visitors</div>
            <button
              className="button"
              type="button"
              onClick={handleSaveVisitorMeals}
              disabled={!selectedVisitors.length}
            >
              Save meals for {selectedVisitors.length} visitor
              {selectedVisitors.length === 1 ? "" : "s"}
            </button>
            {!selectedVisitors.length ? <div className="muted">Select at least one visitor.</div> : null}
          </>
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
