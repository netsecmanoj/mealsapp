import "dotenv/config";
import express from "express";
import cors from "cors";
import routes from "./routes.js";

const app = express();

const corsOptions = {
  origin: "http://localhost:5173",
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: false,
};

app.use(cors(corsOptions));
app.options(/.*/, cors(corsOptions));
app.use((req, _res, next) => {
  console.log(req.method, req.url);
  next();
});
app.use(express.json());
app.get("/health", (_req, res) => res.json({ ok: true }));
app.use("/api", routes);

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`API server listening on port ${port}`);
});
