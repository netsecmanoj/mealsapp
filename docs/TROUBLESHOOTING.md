# Troubleshooting

## API container exits immediately
**Symptoms**: `Missing required env: DATABASE_URL, JWT_SECRET`

**Fix**:
- Ensure `DATABASE_URL` and `JWT_SECRET` are set in your env file.
- In Docker, confirm `API_ENV_FILE` points to a valid file.

## /api/health returns 502 or 504
**Symptoms**: Nginx cannot reach the API container.

**Fix**:
- Check the API container logs: `docker compose logs -f api`.
- Ensure API is listening on `0.0.0.0:4000` (default).
- Verify `docker compose ps` shows `api` healthy and running.

## Seed errors
**Symptoms**:
- `ERR_MODULE_NOT_FOUND /app/src/seed.ts`
- `Cannot find module dist/seed.js`

**Fix**:
- Local dev: `npm run seed` from `api/`.
- Docker: `docker compose run --rm api npm run seed:prod`.

## SQLite "database is locked"
**Symptoms**: Prisma errors mentioning `SQLITE_BUSY` or locks.

**Fix**:
- Ensure only one API instance writes to the SQLite file.
- Restart the API container to clear stale locks.
- Avoid running multiple migration/seed commands concurrently.

## CORS errors in the browser
**Symptoms**: Browser blocks API calls.

**Fix**:
- In development, use the Vite proxy and call `/api/*`.
- In production with a separate domain, set `CORS_ORIGIN` to allowed origins.

## PWA install prompt missing
**Symptoms**: No install prompt on desktop/mobile.

**Fix**:
- HTTPS is required for PWA install (except `localhost`).
- Verify the service worker loads without errors.

## "Meal not served" or cutoff conflicts
**Symptoms**: API returns `MEAL_NOT_SERVED`, `CUTOFF_PASSED`, or `PAST_DATE`.

**Fix**:
- Check service-day settings and cutoffs in the Admin UI.
- Verify the system timezone (`/api/system/time`).
- HR/Super Admin overrides require a reason.
