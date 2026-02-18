import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login, setSession } from "../lib/api.js";

export default function Login() {
  const navigate = useNavigate();
  const [mode, setMode] = useState("pin");
  const [employeeId, setEmployeeId] = useState("");
  const [pin, setPin] = useState("");
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const payload =
        mode === "pin"
          ? { employeeId: employeeId.trim(), pin: pin.trim() }
          : { identifier: identifier.trim(), password };
      const result = await login(payload);
      setSession(result);
      navigate("/schedule");
    } catch (err) {
      setError(err?.message || err?.toString?.() || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <div className="card">
        <h2>Meal Scheduling Login</h2>
        <div className="button-group" style={{ marginBottom: 12 }}>
          <button
            className={`button ${mode === "pin" ? "" : "secondary"}`}
            type="button"
            onClick={() => {
              setMode("pin");
              setError("");
            }}
          >
            Use PIN
          </button>
          <button
            className={`button ${mode === "password" ? "" : "secondary"}`}
            type="button"
            onClick={() => {
              setMode("password");
              setError("");
            }}
          >
            Use Password
          </button>
        </div>
        <form onSubmit={handleSubmit}>
          {mode === "pin" ? (
            <>
              <div className="field">
                <label htmlFor="employeeId">Employee ID</label>
                <input
                  id="employeeId"
                  value={employeeId}
                  onChange={(event) => setEmployeeId(event.target.value)}
                  placeholder="A1001"
                  autoComplete="username"
                />
              </div>
              <div className="field">
                <label htmlFor="pin">PIN</label>
                <input
                  id="pin"
                  type="password"
                  value={pin}
                  onChange={(event) => setPin(event.target.value)}
                  placeholder="1234"
                  autoComplete="current-password"
                />
              </div>
            </>
          ) : (
            <>
              <div className="field">
                <label htmlFor="identifier">Employee ID or Email</label>
                <input
                  id="identifier"
                  value={identifier}
                  onChange={(event) => setIdentifier(event.target.value)}
                  placeholder="A1001 or user@akshayakalpa.org"
                  autoComplete="username"
                />
              </div>
              <div className="field">
                <label htmlFor="password">Password</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  placeholder="Password"
                  autoComplete="current-password"
                />
              </div>
            </>
          )}
          <button className="button" type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
        {error ? <div className="message error">{error}</div> : null}
      </div>
    </div>
  );
}
