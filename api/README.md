# MealApp API (Phase 1)

## Setup

```bash
npm install
npm run prisma:migrate
npm run seed
npm run dev
```

The API runs on `http://localhost:4000` by default.

## Sample login

```bash
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"employeeId":"A1001","pin":"1234"}'
```

Use the returned `token` as a Bearer token for authenticated requests.
