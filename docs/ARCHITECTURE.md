# Architecture

## Components
- Web UI: React + Vite + PWA, served by Nginx
- API: Node/Express (TypeScript), Prisma ORM
- Database: SQLite (single file)

## Deployment diagram (text)
```
[User Browser]
     |
     |  HTTPS (recommended)
     v
[Nginx (web container)]
  |            |
  |            +--> /api/* -> [API container :4000]
  |                            |
  |                            +--> Prisma -> SQLite (/data/meals.sqlite)
  +--> / -> static web assets (Vite build)
```

## Data flow (examples)

### Login
1) User submits employee ID + PIN to `/api/auth/login`.
2) API verifies bcrypt hash, returns a JWT and user profile.
3) Web stores JWT in localStorage and includes it in `Authorization: Bearer`.

### Meal choices
1) User selects choices for a date range.
2) Web calls `/api/me/choice` or `/api/me/choices`.
3) API checks cutoffs + service-day rules and writes to `MealChoice`.
4) Audit logs are recorded for overrides and admin actions.

### Daily report
1) Supervisor/HR/Admin requests `/api/reports/daily`.
2) API aggregates `MealChoice`, preferences, approvals, and check-ins.
3) API returns counts plus waste (yes minus check-ins).

## Storage locations
- Dev DB (default): `api/prisma/meals.sqlite`
- Docker DB path inside container: `/data/meals.sqlite`
- Docker host path (default): `/home/ubuntu/meals-app/db/meals.sqlite`

## Notes
- `/api/health` checks DB connectivity.
- The PWA service worker uses NetworkOnly for `/api/*` GETs.
