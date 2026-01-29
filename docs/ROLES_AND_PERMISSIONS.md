# Roles and Permissions

This is based on current API route guards in `api/src/routes.ts` and the UI route gating in `web/src/App.jsx`.

## Role summaries

### EMPLOYEE
- UI: Schedule, Calendar
- API: self choices, self requests, service days, system time

### SUPERVISOR
- UI: Schedule, Calendar, Report, Supervisor
- API: staff choice overrides for assigned employees, visitor meal management, reports

### ADMIN
- UI: Schedule, Calendar, Report
- API: reports, staff choice overrides, visitor meal management
- Note: Admin has API access to supervisor endpoints but the current UI does not expose the Supervisor page for ADMIN.

### HR_ADMIN
- UI: Schedule, Calendar, Report, Supervisor, Availability, Users, Defaults, Requests
- API: user management, supervisor assignments, preferences defaults, service days, request approvals, reports

### SUPER_ADMIN
- UI: all HR_ADMIN pages + Settings + Kiosk
- API: all HR_ADMIN actions + settings management + kiosk endpoints

### GROUND_STAFF
- UI: Kiosk
- API: kiosk check-ins and status

## Permission matrix (high level)

| Capability | EMPLOYEE | SUPERVISOR | ADMIN | HR_ADMIN | SUPER_ADMIN | GROUND_STAFF |
| --- | --- | --- | --- | --- | --- | --- |
| Log in | Yes | Yes | Yes | Yes | Yes | Yes |
| Manage own meal choices | Yes | Yes | Yes | Yes | Yes | Yes |
| Submit meal requests | Yes | Yes | Yes | Yes | Yes | Yes |
| View daily report | No | Yes | Yes | Yes | Yes | No |
| Update staff choices | No | Yes | Yes | Yes | Yes | No |
| Manage visitor meals | No | Yes | Yes | Yes | Yes | No |
| Manage users | No | No | No | Yes | Yes | No |
| Manage defaults (preferences) | No | No | No | Yes | Yes | No |
| Manage service days | No | No | No | Yes | Yes | No |
| Approve/reject requests | No | No | No | Yes | Yes | No |
| System settings (timezone, cutoffs) | No | No | No | No | Yes | No |
| Kiosk check-in | No | No | No | No | Yes | Yes |

## Notes
- All protected routes require a valid JWT (`Authorization: Bearer <token>`).
- Some admin actions require a reason (e.g., post-cutoff overrides, request decisions).
