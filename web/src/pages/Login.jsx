import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login, setSession } from "../lib/api.js";

export default function Login() {
  const navigate = useNavigate();
  const [employeeId, setEmployeeId] = useState("");
  const [pin, setPin] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError("");
    setLoading(true);

    try {
      const result = await login(employeeId.trim(), pin.trim());
      setSession(result);
      navigate("/schedule");
    } catch (err) {
      setError(err?.toString?.() || "Login failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="app">
      <div className="card">
        <h2>Meal Scheduling Login</h2>
        <form onSubmit={handleSubmit}>
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
          <button className="button" type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </form>
        {error ? <div className="message error">{error}</div> : null}
      </div>
    </div>
  );
}
