import { useEffect, useState } from "react";
import { getSettings, updateSettings } from "../lib/api.js";

export default function Settings() {
  const [settings, setSettings] = useState(null);
  const [timezone, setTimezone] = useState("");
  const [breakfastCutoff, setBreakfastCutoff] = useState("");
  const [lunchCutoff, setLunchCutoff] = useState("");
  const [dinnerCutoff, setDinnerCutoff] = useState("");
  const [weeklyTemplate, setWeeklyTemplate] = useState("{");
  const [reason, setReason] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    getSettings()
      .then((data) => {
        if (!active) return;
        setSettings(data);
        setTimezone(data.timezone || "");
        setBreakfastCutoff(data.cutoffs?.BREAKFAST || "");
        setLunchCutoff(data.cutoffs?.LUNCH || "");
        setDinnerCutoff(data.cutoffs?.DINNER || "");
        setWeeklyTemplate(JSON.stringify(data.weeklyTemplate || { sundayClosed: true }, null, 2));
      })
      .catch((err) => {
        if (!active) return;
        setError(err.message || "Failed");
      });
    return () => {
      active = false;
    };
  }, []);

  const handleSave = async () => {
    setMessage("");
    setError("");
    if (!reason.trim()) {
      setError("Reason is required");
      return;
    }
    try {
      const payload = {
        settings: {
          timezone: timezone.trim(),
          "cutoff.breakfast": breakfastCutoff.trim(),
          "cutoff.lunch": lunchCutoff.trim(),
          "cutoff.dinner": dinnerCutoff.trim(),
          weeklyTemplate: weeklyTemplate.trim(),
        },
        reason: reason.trim(),
      };
      const updated = await updateSettings(payload);
      setSettings(updated);
      setMessage("Settings saved");
    } catch (err) {
      setError(err.message || "Failed");
    }
  };

  return (
    <div className="app">
      <div className="card">
        <h2>System Settings</h2>
        <div className="field">
          <label>Timezone</label>
          <input value={timezone} onChange={(event) => setTimezone(event.target.value)} />
        </div>
        <div className="field">
          <label>Breakfast cutoff (HH:MM)</label>
          <input value={breakfastCutoff} onChange={(event) => setBreakfastCutoff(event.target.value)} />
        </div>
        <div className="field">
          <label>Lunch cutoff (HH:MM)</label>
          <input value={lunchCutoff} onChange={(event) => setLunchCutoff(event.target.value)} />
        </div>
        <div className="field">
          <label>Dinner cutoff (HH:MM)</label>
          <input value={dinnerCutoff} onChange={(event) => setDinnerCutoff(event.target.value)} />
        </div>
        <div className="field">
          <label>Weekly template (JSON)</label>
          <textarea
            className="textarea"
            value={weeklyTemplate}
            onChange={(event) => setWeeklyTemplate(event.target.value)}
            rows={6}
          />
        </div>
        <div className="field">
          <label>Reason (required)</label>
          <input value={reason} onChange={(event) => setReason(event.target.value)} />
        </div>
        <button className="button" onClick={handleSave}>
          Save
        </button>
        <div className="settings-readonly">
          <div>JWT expiry minutes: {settings?.jwtExpiryMinutes}</div>
          <div>PIN min length: {settings?.pinPolicyMinLength}</div>
        </div>
        {message ? <div className="message success">{message}</div> : null}
        {error ? <div className="message error">{error}</div> : null}
      </div>
    </div>
  );
}
