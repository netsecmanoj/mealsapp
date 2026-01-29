# Meals App Deployment (Docker + Nginx)

This is a quick deployment summary. For the full runbook and upgrade steps, see docs/DEPLOYMENT.md.

## Server paths (defaults)
- Repo: `/home/ubuntu/meals-app/current`
- Env file: `/home/ubuntu/meals-app/config/api.env`
- DB dir: `/home/ubuntu/meals-app/db`
- DB file: `/home/ubuntu/meals-app/db/meals.sqlite`

These paths can be overridden for local runs using:
- `API_ENV_FILE` (env file path)
- `API_DB_DIR` (host DB directory mounted to `/data`)

## Minimal deploy flow
```bash
cd /home/ubuntu/meals-app/current

docker compose build
# Apply migrations before starting containers
docker compose run --rm api npx prisma migrate deploy

docker compose up -d --remove-orphans
```

## Verify
```bash
curl -i http://<server-ip>:8095/api/health
```

## Notes
- Web is exposed on port `8095` (host) -> `80` (container).
- API is exposed on port `4000` (host) -> `4000` (container).
- SQLite is mounted into the API container at `/data`.
