import express from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { MealType, PrismaClient, Role, Source } from "@prisma/client";
import { authMiddleware, requireRole, signToken } from "./auth.js";

const prisma = new PrismaClient();
const router = express.Router();

function normalizeDateOnly(dateStr: string): Date {
  const [year, month, day] = dateStr.split("-").map((part) => Number(part));
  return new Date(Date.UTC(year, month - 1, day));
}

const dateOnlySchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

function formatDateOnly(date: Date): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const cutoffTimes = {
  [MealType.BREAKFAST]: { hour: 9, minute: 0, label: "09:00" },
  [MealType.LUNCH]: { hour: 11, minute: 0, label: "11:00" },
  [MealType.DINNER]: { hour: 17, minute: 0, label: "17:00" },
};

function getCutoffDate(dateStr: string, mealType: MealType): Date {
  const [year, month, day] = dateStr.split("-").map((part) => Number(part));
  const cutoff = cutoffTimes[mealType];
  return new Date(year, month - 1, day, cutoff.hour, cutoff.minute, 0, 0);
}

router.post("/auth/login", async (req, res) => {
  const schema = z.object({
    employeeId: z.string().trim().min(1),
    pin: z.string().trim().min(1),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const { employeeId, pin } = parsed.data;
  const user = await prisma.user.findFirst({
    where: { employeeId, active: true },
  });

  if (!user) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const match = await bcrypt.compare(pin, user.pinHash);
  if (!match) {
    return res.status(401).json({ error: "Invalid credentials" });
  }

  const token = signToken({
    id: user.id,
    employeeId: user.employeeId,
    name: user.name,
    dept: user.dept,
    role: user.role,
  });

  return res.json({
    token,
    user: {
      employeeId: user.employeeId,
      name: user.name,
      role: user.role,
      dept: user.dept,
    },
  });
});

router.get("/me/choices", authMiddleware, async (req, res) => {
  const schema = z.object({
    from: dateOnlySchema,
    to: dateOnlySchema,
  });

  const parsed = schema.safeParse(req.query);
  if (!parsed.success || !req.user) {
    return res.status(400).json({ error: "Invalid date range" });
  }

  const fromDate = normalizeDateOnly(parsed.data.from);
  const toDate = normalizeDateOnly(parsed.data.to);

  const choices = await prisma.mealChoice.findMany({
    where: {
      userId: req.user.id,
      date: {
        gte: fromDate,
        lte: toDate,
      },
    },
    select: {
      date: true,
      mealType: true,
      wantMeal: true,
    },
    orderBy: [{ date: "asc" }, { mealType: "asc" }],
  });

  return res.json(
    choices.map((choice) => ({
      date: formatDateOnly(choice.date),
      mealType: choice.mealType,
      wantMeal: choice.wantMeal,
    }))
  );
});

router.post("/me/choice", authMiddleware, async (req, res) => {
  const schema = z.object({
    date: dateOnlySchema,
    mealType: z.nativeEnum(MealType),
    wantMeal: z.boolean(),
  });

  const parsed = schema.safeParse(req.body);
  if (!parsed.success || !req.user) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const { date, mealType, wantMeal } = parsed.data;
  const dateValue = normalizeDateOnly(date);
  const cutoffDate = getCutoffDate(date, mealType);
  if (new Date() > cutoffDate) {
    return res.status(403).json({ error: "Cutoff passed" });
  }

  const choice = await prisma.mealChoice.upsert({
    where: {
      userId_date_mealType: {
        userId: req.user.id,
        date: dateValue,
        mealType,
      },
    },
    create: {
      userId: req.user.id,
      date: dateValue,
      mealType,
      wantMeal,
      source: Source.SELF,
      updatedById: null,
    },
    update: {
      wantMeal,
      source: Source.SELF,
      updatedById: null,
    },
  });

  return res.json({
    id: choice.id,
    date,
    mealType: choice.mealType,
    wantMeal: choice.wantMeal,
    source: choice.source,
  });
});

router.post(
  "/staff/choice",
  authMiddleware,
  requireRole([Role.SUPERVISOR, Role.ADMIN]),
  async (req, res) => {
    const schema = z.object({
      employeeId: z.string().trim().min(1),
      date: dateOnlySchema,
      mealType: z.nativeEnum(MealType),
      wantMeal: z.boolean(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success || !req.user) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const { employeeId, date, mealType, wantMeal } = parsed.data;
    const dateValue = normalizeDateOnly(date);

    const targetUser = await prisma.user.findFirst({
      where: { employeeId, active: true },
    });

    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    const source = req.user.role === Role.ADMIN ? Source.ADMIN : Source.SUPERVISOR;

    const choice = await prisma.mealChoice.upsert({
      where: {
        userId_date_mealType: {
          userId: targetUser.id,
          date: dateValue,
          mealType,
        },
      },
      create: {
        userId: targetUser.id,
        date: dateValue,
        mealType,
        wantMeal,
        source,
        updatedById: req.user.id,
      },
      update: {
        wantMeal,
        source,
        updatedById: req.user.id,
      },
    });

    return res.json({
      id: choice.id,
      employeeId: targetUser.employeeId,
      date,
      mealType: choice.mealType,
      wantMeal: choice.wantMeal,
      source: choice.source,
    });
  }
);

router.get(
  "/users",
  authMiddleware,
  requireRole([Role.SUPERVISOR, Role.ADMIN]),
  async (_req, res) => {
    const users = await prisma.user.findMany({
      where: { active: true },
      orderBy: { employeeId: "asc" },
      select: {
        employeeId: true,
        name: true,
        dept: true,
        role: true,
      },
    });

    return res.json(users);
  }
);

router.get(
  "/reports/daily",
  authMiddleware,
  requireRole([Role.SUPERVISOR, Role.ADMIN]),
  async (req, res) => {
    const parsed = dateOnlySchema.safeParse(req.query.date);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid date" });
    }

    const dateStr = parsed.data;
    const dateValue = normalizeDateOnly(dateStr);

    const rows = await prisma.mealChoice.groupBy({
      by: ["mealType"],
      where: {
        date: dateValue,
        wantMeal: true,
      },
      _count: { _all: true },
    });

    const counts = {
      BREAKFAST: 0,
      LUNCH: 0,
      DINNER: 0,
    };

    for (const row of rows) {
      counts[row.mealType] = row._count._all;
    }

    return res.json({ date: dateStr, counts });
  }
);

export default router;
export { normalizeDateOnly };
