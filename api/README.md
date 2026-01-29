# Meals App API

## Local setup

```bash
cd api
npm install

# Create api/.env (see repo README for example values)

npm run prisma:migrate
npm run seed
npm run dev
```

The API runs on `http://localhost:4000` by default.

## Production seed

Inside a built container (or after running `npm run build`), use:

```bash
npm run seed:prod
```

## Sample login

```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"employeeId":"A1001","pin":"1234"}'
```

Use the returned `token` as a Bearer token for authenticated requests.
