# Meals Scheduling & Waste Tracking

A web app for planning office meals, handling exceptions, and tracking waste. It supports multiple roles (employees, supervisors, HR, admins, and ground staff) with audit logging and a kiosk check-in flow.

Quick links:
- docs/ARCHITECTURE.md
- docs/ROLES_AND_PERMISSIONS.md
- docs/DEPLOYMENT.md
- docs/TROUBLESHOOTING.md

Production URL:
- https://cafeteria.akshayakalpa.org

## Features
- Employee meal scheduling with cutoff enforcement and timezone-aware rules
- Meal requests/approvals for exceptions
- Supervisor updates for employee choices + visitor meals
- HR/Admin tools for users, defaults, service days, and reports
- Ground-staff kiosk check-ins and live counts
- Daily reports with waste calculation
- Audit logging for sensitive actions
- PWA-ready web UI (HTTPS required for install prompt)

## Roles (overview)
- EMPLOYEE: manage own meal choices, view calendar, submit requests
- SUPERVISOR: update team choices and visitor meals
- ADMIN: view reports, update staff choices, manage visitor meals
- HR_ADMIN: user management, defaults, service days, requests, reports
- SUPER_ADMIN: all HR_ADMIN actions + system settings
- GROUND_STAFF: kiosk check-ins and status

Full details: docs/ROLES_AND_PERMISSIONS.md

## Architecture (high level)
```
Browser (React/Vite/PWA)
  -> /api/* (Nginx proxy)
      -> API (Node/Express)
          -> Prisma
              -> SQLite DB file
```
More detail: docs/ARCHITECTURE.md

## Local development

### Prereqs
- Node.js 20+ and npm
- (Optional) Docker + Docker Compose

### API (Node/Express)
```bash
cd api
npm install

# Create api/.env
# See "Environment variables" below for example values.

npm run prisma:migrate
npm run seed
npm run dev
```

API runs at `http://localhost:4000`.

### Web (React/Vite)
```bash
cd web
npm install

# Optional: create web/.env.local
# VITE_API_BASE_URL=http://localhost:4000

npm run dev
```

Web runs at `http://localhost:5173` by default (Vite may auto-pick a different port).

### Sample login (seed data)
- Employee ID: `A1001`
- PIN: `1234`

Change or disable the seed user in production.

## Environment variables

### API (`api/.env` for local dev)
```bash
DATABASE_URL=file:./prisma/meals.sqlite
JWT_SECRET=replace-with-a-long-random-string
PORT=4000
HOST=0.0.0.0
# Optional, comma-separated origins for CORS in production
# CORS_ORIGIN=https://example.com,https://admin.example.com
```

### Web (`web/.env.local`, optional)
```bash
# Defaults to "/api" (recommended behind the Nginx proxy)
VITE_API_BASE_URL=http://localhost:4000
```

## Database (Prisma + SQLite)
- Prisma schema: api/prisma/schema.prisma
- Dev DB file (default): `api/prisma/meals.sqlite`
- Docker DB file (inside container): `/data/meals.sqlite`
- Docker host path (default): `/home/ubuntu/meals-app/db/meals.sqlite`

SQLite files are created automatically when migrations run.

## Migrations & seed

### Local dev
```bash
cd api
npm run prisma:migrate
npm run seed
```

### Docker / production
```bash
# Apply migrations in a running environment
docker compose run --rm api npx prisma migrate deploy

# Optional seed (uses compiled dist/seed.js)
docker compose run --rm api npm run seed:prod
```

Notes:
- Seed uses upserts and is safe to run multiple times.
- Default seed PIN is `1234` for sample users.

## Docker build & compose (local or server)

The Compose file defaults to server paths, but can be overridden for local use:
- `API_ENV_FILE` (env file path)
- `API_DB_DIR` (host DB directory mounted to `/data`)

Example local Docker run:
```bash
export API_ENV_FILE=./api/.env
export API_DB_DIR=./api/prisma

docker compose build
# Optional: run migrations
# docker compose run --rm api npx prisma migrate deploy

docker compose up -d
```

Ports:
- HTTP: `80` -> `caddy` (redirects to HTTPS)
- HTTPS: `443` -> `caddy` (public entrypoint)
- `web` and `api` are internal-only on the Docker network

Health check (via web proxy):
```bash
curl -i https://cafeteria.akshayakalpa.org/api/health
```

## Server deployment runbook (Ubuntu + Docker)

1) Install Docker + Docker Compose plugin.
2) Create directories:
```bash
sudo mkdir -p /home/ubuntu/meals-app/db /home/ubuntu/meals-app/config
sudo touch /home/ubuntu/meals-app/db/meals.sqlite
sudo chown -R ubuntu:ubuntu /home/ubuntu/meals-app
```
3) Create `/home/ubuntu/meals-app/config/api.env`:
```bash
DATABASE_URL=file:/data/meals.sqlite
JWT_SECRET=replace-with-a-long-random-string
PORT=4000
HOST=0.0.0.0
```
4) Open firewall ports:
- TCP 22 (restricted)
- TCP 80 (public, required for ACME HTTP challenge + redirect)
- TCP 443 (public HTTPS)
5) Deploy:
```bash
cd /home/ubuntu/meals-app/current

docker compose build
# apply migrations
docker compose run --rm api npx prisma migrate deploy

docker compose up -d --remove-orphans
```
6) Verify:
```bash
curl -I http://cafeteria.akshayakalpa.org
curl -I https://cafeteria.akshayakalpa.org
curl -i https://cafeteria.akshayakalpa.org/api/health
```
7) Logs:
```bash
docker compose logs -f api
```

Full checklist: docs/DEPLOYMENT.md

## Troubleshooting (common issues)
- Missing env vars: API exits if `DATABASE_URL` or `JWT_SECRET` is missing.
- Seed errors: use `npm run seed` locally, `npm run seed:prod` in Docker.
- `/api/health` 502: API container down or Nginx cannot reach `api:4000`.
- SQLite locked: stop concurrent writers or restart API.
- PWA install prompt missing: HTTPS is required (except localhost).

More: docs/TROUBLESHOOTING.md

## Security notes
- PINs are stored as bcrypt hashes in the database.
- PIN policy settings exist in AppSetting, but API validation currently only enforces non-empty PINs.
- JWTs are signed with `JWT_SECRET` and expire after 7 days (hardcoded in api/src/auth.ts).
- No rate limiting is implemented yet.
- Admin actions write to `AuditLog` (includes actor, action, and before/after when provided).

## Backup & restore (SQLite)
- Stop the API container.
- Copy the DB file from `/home/ubuntu/meals-app/db/meals.sqlite`.
- Store backups off-host (daily recommended).
- To restore: stop containers, replace the DB file, restart containers.

## Roadmap / TODO
- Kiosk workflow improvements (fast lane + badge scanning)
- Supervisor bulk group updates
- CSV import for users and preferences
