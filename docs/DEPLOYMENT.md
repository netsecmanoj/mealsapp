# Deployment (Ubuntu + Docker)

This project deploys two containers:
- `web` (Nginx serving the Vite build)
- `api` (Node/Express API + Prisma)

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
```

5) Open firewall ports:
- TCP 22 (restricted)
- TCP 8095 (public)
- TCP 443 (optional for TLS termination)

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

## Verify
```bash
curl -i http://<server-ip>:8095/api/health
```

## Logs
```bash
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

## Rollback
- Re-deploy a previous commit (via your CI/CD or manual checkout) and run the same deploy steps.
- Restore the DB file if schema compatibility is an issue.

## Rollback procedure

### Revert this commit (git revert)
```bash
git revert <sha>
```

### Redeploy a previous commit on the server
```bash
git checkout <sha>
docker compose build
docker compose up -d --remove-orphans
```

### Backup reminder
Before any migration changes, back up:
`/home/ubuntu/meals-app/db/meals.sqlite`

## Notes
- `/api/health` checks database connectivity.
- For HTTPS, terminate TLS in front of Nginx (or replace Nginx config with TLS-enabled setup).
