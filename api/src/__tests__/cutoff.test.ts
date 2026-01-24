process.env.TZ = "UTC";

import assert from "node:assert/strict";
import { addDaysToDateString, getZonedDateString, zonedTimeToUtc } from "../timezone.js";

const timezone = "Asia/Kolkata";

{
  const cutoff = zonedTimeToUtc("2026-01-24", "09:00", timezone);
  assert.equal(cutoff.toISOString(), "2026-01-24T03:30:00.000Z");
}

{
  const cutoffDate = addDaysToDateString("2026-01-24", -1);
  const cutoff = zonedTimeToUtc(cutoffDate, "21:00", timezone);
  assert.equal(cutoff.toISOString(), "2026-01-23T15:30:00.000Z");
}

{
  const now = new Date("2026-01-24T04:00:00.000Z");
  const cutoff = zonedTimeToUtc("2026-01-24", "09:00", timezone);
  assert.equal(now > cutoff, true);
}

{
  const now = new Date("2026-01-24T03:00:00.000Z");
  const cutoff = zonedTimeToUtc("2026-01-24", "09:00", timezone);
  assert.equal(now > cutoff, false);
}

{
  const cutoffDate = addDaysToDateString("2026-01-24", -1);
  const cutoff = zonedTimeToUtc(cutoffDate, "21:00", timezone);
  const now = new Date("2026-01-23T14:00:00.000Z");
  assert.equal(now > cutoff, false);
}

{
  const cutoffDate = addDaysToDateString("2026-01-24", -1);
  const cutoff = zonedTimeToUtc(cutoffDate, "21:00", timezone);
  const now = new Date("2026-01-23T16:00:00.000Z");
  assert.equal(now > cutoff, true);
}

{
  const now = new Date("2026-01-23T23:00:00.000Z");
  assert.equal(getZonedDateString(timezone, now), "2026-01-24");
}

console.log("cutoff timezone tests passed");
