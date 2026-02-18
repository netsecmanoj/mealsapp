import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getInvite, registerFromInvite, setSession } from "../lib/api.js";

export default function InviteRegistration() {
  const { token = "" } = useParams();
  const navigate = useNavigate();
  const [invite, setInvite] = useState(null);
  const [loadingInvite, setLoadingInvite] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [form, setForm] = useState({
    employeeId: "",
    name: "",
    password: "",
    phone: "",
  });
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    const run = async () => {
      setError("");
      setLoadingInvite(true);
      try {
        const data = await getInvite(token);
        if (!active) return;
        setInvite(data);
      } catch (err) {
        if (!active) return;
        setError(err?.message || "Invite is invalid or expired");
      } finally {
        if (active) setLoadingInvite(false);
      }
    };
    if (!token) {
      setError("Invite token is missing");
      setLoadingInvite(false);
      return () => {
        active = false;
      };
    }
    run();
    return () => {
      active = false;
    };
  }, [token]);

  const onSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setMessage("");
    setSubmitting(true);
    try {
      const result = await registerFromInvite({
        token,
        employeeId: form.employeeId.trim(),
        name: form.name.trim(),
        password: form.password,
        phone: form.phone.trim() || undefined,
        dept: invite?.dept || undefined,
        site: invite?.site || undefined,
      });
      setSession(result);
      navigate("/schedule");
    } catch (err) {
      setError(err?.message || "Registration failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="app">
      <div className="card">
        <h2>Complete Your Registration</h2>
        {loadingInvite ? <div className="message">Loading invite...</div> : null}
        {!loadingInvite && invite ? (
          <>
            <div className="field">
              <label>Email (from invite)</label>
              <input value={invite.email || ""} disabled />
            </div>
            <div className="field">
              <label>Role</label>
              <input value={invite.role || ""} disabled />
            </div>
            <div className="field">
              <label>Department</label>
              <input value={invite.dept || "Unassigned"} disabled />
            </div>
            <div className="field">
              <label>Site</label>
              <input value={invite.site || "Unassigned"} disabled />
            </div>
            <form onSubmit={onSubmit}>
              <div className="field">
                <label htmlFor="employeeId">Employee ID</label>
                <input
                  id="employeeId"
                  value={form.employeeId}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, employeeId: event.target.value }))
                  }
                  placeholder="E1234"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="name">Name</label>
                <input
                  id="name"
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                  placeholder="Your full name"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  value={form.password}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, password: event.target.value }))
                  }
                  placeholder="At least 8 chars with upper/lower/number/symbol"
                  required
                />
              </div>
              <div className="field">
                <label htmlFor="phone">Phone (optional)</label>
                <input
                  id="phone"
                  value={form.phone}
                  onChange={(event) => setForm((prev) => ({ ...prev, phone: event.target.value }))}
                  placeholder="Mobile number"
                />
              </div>
              <button className="button" type="submit" disabled={submitting}>
                {submitting ? "Creating account..." : "Register"}
              </button>
            </form>
          </>
        ) : null}
        {message ? <div className="message success">{message}</div> : null}
        {error ? <div className="message error">{error}</div> : null}
      </div>
    </div>
  );
}
