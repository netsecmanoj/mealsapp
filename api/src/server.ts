import "dotenv/config";
import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import routes from "./routes.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

const app = express();

const requiredEnv = ["DATABASE_URL", "JWT_SECRET"];
const missingEnv = requiredEnv.filter((key) => !process.env[key]);
if (missingEnv.length > 0) {
  console.error(`Missing required env: ${missingEnv.join(", ")}`);
  process.exit(1);
}

const corsOrigin = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",").map((origin) => origin.trim()).filter(Boolean)
  : process.env.NODE_ENV === "production"
    ? null
    : true;

if (corsOrigin) {
  const corsOptions = {
    origin: corsOrigin,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    credentials: false,
  };
  app.use(cors(corsOptions));
  app.options(/.*/, cors(corsOptions));
}
app.use((req, _res, next) => {
  console.log(req.method, req.url);
  next();
});
app.use(express.json());
const prisma = new PrismaClient();

app.get("/health", (_req, res) => res.json({ ok: true }));
app.get("/api/health", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});
app.use("/api", routes);

const port = Number(process.env.PORT) || 4000;
const host = process.env.HOST || "0.0.0.0";
app.listen(port, host, () => {
  console.log(`API server listening on http://${host}:${port}`);
});
