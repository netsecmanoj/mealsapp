# Deployment (Ubuntu + Docker)

This project deploys three containers:
- `caddy` (public reverse proxy + TLS termination)
- `web` (Nginx serving the Vite build, internal only)
- `api` (Node/Express API + Prisma, internal only)

SQLite is persisted on the host and mounted into the API container.

## One-time server setup

1) Install Docker + Docker Compose plugin (Ubuntu 22.04+):
```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

2) Allow the `ubuntu` user to run Docker:
```bash
sudo usermod -aG docker ubuntu
```
Log out and back in.

3) Create runtime directories:
```bash
sudo mkdir -p /home/ubuntu/meals-app/db /home/ubuntu/meals-app/config
sudo touch /home/ubuntu/meals-app/db/meals.sqlite
sudo chown -R ubuntu:ubuntu /home/ubuntu/meals-app
```

4) Create `/home/ubuntu/meals-app/config/api.env`:
```bash
DATABASE_URL=file:/data/meals.sqlite
JWT_SECRET=replace-with-a-long-random-string
PORT=4000
HOST=0.0.0.0
AUTH_MODE=pin
INVITE_ALLOWED_DOMAIN=akshayakalpa.org
INVITE_TTL_HOURS=72
INVITE_BASE_URL=https://cafeteria.akshayakalpa.org
```

5) Open firewall/security-group ports:
- TCP 22 (restricted)
- TCP 80 (public, required for ACME challenge + HTTP->HTTPS redirect)
- TCP 443 (public HTTPS)

## HTTPS with Caddy (`cafeteria.akshayakalpa.org`)

1) DNS requirement:
- Create an `A` record for `cafeteria.akshayakalpa.org` pointing to your server public IPv4.

2) Start services:
```bash
cd /home/ubuntu/meals-app/current
docker compose up -d --build
```

3) Caddy behavior:
- Automatically obtains and renews Let's Encrypt certificates.
- Terminates TLS on `:443`.
- Redirects HTTP (`:80`) to HTTPS.
- Proxies all traffic to `web:80`.

4) Certificate storage:
- Caddy stores certificate/account state in Docker named volume `caddy_data`.
- Additional runtime config is in Docker named volume `caddy_config`.

## Auth Phase 1: Invite + Password login

Auth mode switch:
- `AUTH_MODE=pin` -> only legacy PIN login
- `AUTH_MODE=both` -> PIN + password login
- `AUTH_MODE=password` -> only password login

Invite flow:
1) HR_ADMIN/SUPER_ADMIN creates invite via `POST /api/admin/invites`
2) Share `https://cafeteria.akshayakalpa.org/invite/<token>`
3) Employee completes registration at `/invite/:token`
4) App calls `POST /api/auth/register` and signs in user

Domain restriction:
- Invite, registration, and email-login are restricted to `@akshayakalpa.org`

## Deploy / upgrade

Assuming the repo is synced to `/home/ubuntu/meals-app/current`:

```bash
cd /home/ubuntu/meals-app/current

docker compose build
# Apply migrations before starting new containers
# (This uses the same DATABASE_URL mounted at /data)
docker compose run --rm api npx prisma migrate deploy

docker compose up -d --remove-orphans
```

## Verification

```bash
docker compose config
docker compose up -d --build
docker compose logs -f caddy
curl -I http://cafeteria.akshayakalpa.org
curl -I https://cafeteria.akshayakalpa.org
curl -i https://cafeteria.akshayakalpa.org/api/health
ss -lntp | egrep ':80|:443|:8095|:4000'
```

Expected results:
- HTTP returns `301` or `308` redirect to HTTPS.
- HTTPS responds with valid TLS and `200` for app pages.
- `/api/health` returns API health payload through the web proxy path.
- Only ports `80` and `443` are publicly bound by Compose services.

## Logs
```bash
docker compose logs -f caddy
docker compose logs -f web
docker compose logs -f api
```

## Backup before upgrades
```bash
# Stop API to avoid SQLite writes during backup
docker compose stop api

# Ensure backup directory exists
mkdir -p /home/ubuntu/meals-app/db/backups
cp /home/ubuntu/meals-app/db/meals.sqlite /home/ubuntu/meals-app/db/backups/meals-$(date +%F).sqlite

# Restart API
docker compose start api
```

## Rollback procedure

Option A: revert commit and redeploy
```bash
git revert <sha>
docker compose down
docker compose up -d
```

Option B: checkout previous known-good commit and redeploy
```bash
git checkout <previous_sha>
docker compose down
docker compose up -d
```

Auth Phase 1 rollback anchor:
```bash
git checkout pre-auth-phase1
docker compose down
docker compose up -d
```

If temporary direct access is needed during rollback:
- Restore old port mappings for `web` (`8095:80`) and `api` (`4000:4000`) in `docker-compose.yml`, then redeploy.

DB safety:
- Do not delete Docker volumes for DB data.
- Do not delete `/home/ubuntu/meals-app/db/meals.sqlite`.

## Notes
- `/api/health` checks database connectivity.
- Existing `API_ENV_FILE` and `API_DB_DIR` fallbacks remain supported in Compose.
- Phase 2 will remove PIN login after password rollout is complete.
