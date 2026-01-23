# Meals App Deployment (Docker + Nginx + GitLab CI/CD)

This deploys the Vite web app behind Nginx and the Node/Express API in Docker, with SQLite persisted on the host.

## One-time server setup

1) Install Docker and Docker Compose:
```sh
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

2) Allow ubuntu user to run Docker without sudo:
```sh
sudo usermod -aG docker ubuntu
```
Log out and back in for group changes to apply.

3) Create runtime directories:
```sh
sudo mkdir -p /home/ubuntu/meals-app/db
sudo mkdir -p /home/ubuntu/meals-app/config
sudo touch /home/ubuntu/meals-app/db/meals.sqlite
sudo chown -R ubuntu:ubuntu /home/ubuntu/meals-app
```

4) Create `/home/ubuntu/meals-app/config/api.env` (secrets live on server, not in repo):
```sh
DATABASE_URL=file:/data/meals.sqlite
JWT_SECRET=replace-with-strong-secret
PORT=4000
HOST=0.0.0.0
```

5) Ensure firewall allows SSH and app port:
- TCP 22 (restricted)
- TCP 8095 (public)
- 443 optional for later TLS termination

## GitLab CI/CD variables

Required variables in GitLab project settings:
- `DEPLOY_HOST`
- `DEPLOY_USER`
- `SSH_PRIVATE_KEY`

Optional variables:
- `SSH_PORT` (default: 22)
- `DEPLOY_PATH` (default: /home/ubuntu/meals-app)

GitLab provides:
- `CI_REGISTRY`, `CI_REGISTRY_IMAGE`, `CI_JOB_TOKEN`

## GitLab Runner prerequisites

- Runner must mount the Docker socket into job containers: `/var/run/docker.sock:/var/run/docker.sock`
- Runner must have Docker CLI available (build jobs use `docker:24` image)
- If you prefer DinD instead, remove the socket mount, enable privileged mode, and add a DinD service in `.gitlab-ci.yml`
 - CI pipeline is configured to run only on the `development` branch

## Server layout (runtime)

- `/home/ubuntu/meals-app/docker-compose.yml`
- `/home/ubuntu/meals-app/.env` (contains only `REGISTRY_IMAGE` and `IMAGE_TAG`)
- `/home/ubuntu/meals-app/config/api.env` (secrets + DATABASE_URL)
- `/home/ubuntu/meals-app/db/meals.sqlite` (persistent database)

## Deployment flow (from main branch)

1) CI builds and pushes:
- `meals-api:${CI_COMMIT_SHA}`
- `meals-web:${CI_COMMIT_SHA}`

2) CI deploys to server:
- Writes `/home/ubuntu/meals-app/.env` with:
  - `REGISTRY_IMAGE=${CI_REGISTRY_IMAGE}`
  - `IMAGE_TAG=${CI_COMMIT_SHA}`
- Copies `docker-compose.yml`
- `docker compose pull`
- `docker compose run --rm api npx prisma migrate deploy`
- `docker compose up -d --remove-orphans`

## Local verification (optional)

Run from repo root:
```sh
docker compose up --build
```
Then test:
- Web: http://localhost:8095
- API health (via proxy): http://localhost:8095/api/health

## Server verification

```sh
curl -i http://<server-ip>:8095/api/health
docker compose logs -f api
```

## PWA note

PWA install prompts typically require HTTPS (except localhost during development).

## Rollback

1) Find the previous image tag (commit SHA) in GitLab Container Registry.
2) On the server, update `/home/ubuntu/meals-app/.env` to the old tag and redeploy:
```sh
printf 'REGISTRY_IMAGE=%s\nIMAGE_TAG=%s\n' "<registry-image>" "previous_sha" > /home/ubuntu/meals-app/.env
cd /home/ubuntu/meals-app
docker compose pull
docker compose up -d --remove-orphans
```

## Notes
- SQLite is persisted at `/home/ubuntu/meals-app/db/meals.sqlite` and mounted into the API container at `/data/meals.sqlite`.
- Deploys use `npx prisma migrate deploy` only. No resets or seeding.
- Frontend calls the API at the same domain via `/api`.
