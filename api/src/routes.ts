import express from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { MealRequestStatus, MealType, PrismaClient, Role, Source } from "@prisma/client";
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

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

const cutoffTimes = {
  [MealType.BREAKFAST]: { hour: 9, minute: 0, label: "09:00" },
  [MealType.LUNCH]: { hour: 11, minute: 0, label: "11:00" },
  [MealType.DINNER]: { hour: 17, minute: 0, label: "17:00" },
};

const SETTINGS_CACHE_TTL_MS = 60_000;
let settingsCache: { ts: number; data: any } | null = null;

function getDefaultSettings() {
  return {
    timezone: "Asia/Kolkata",
    cutoffs: {
      BREAKFAST: "09:00",
      LUNCH: "11:00",
      DINNER: "17:00",
    },
    weeklyTemplate: { sundayClosed: true },
    jwtExpiryMinutes: "10080",
    pinPolicyMinLength: "4",
  };
}

async function getSettingsSnapshot() {
  if (settingsCache && Date.now() - settingsCache.ts < SETTINGS_CACHE_TTL_MS) {
    return settingsCache.data;
  }
  const defaults = getDefaultSettings();
  const records = await prisma.appSetting.findMany({
    where: {
      key: {
        in: [
          "timezone",
          "cutoff.breakfast",
          "cutoff.lunch",
          "cutoff.dinner",
          "weeklyTemplate",
          "jwtExpiryMinutes",
          "pinPolicyMinLength",
        ],
      },
    },
  });
  const map = new Map(records.map((record) => [record.key, record.value]));
  const weeklyTemplateRaw = map.get("weeklyTemplate");
  let weeklyTemplate = defaults.weeklyTemplate;
  if (weeklyTemplateRaw) {
    try {
      weeklyTemplate = JSON.parse(weeklyTemplateRaw);
    } catch {
      weeklyTemplate = defaults.weeklyTemplate;
    }
  }
  const data = {
    timezone: map.get("timezone") || defaults.timezone,
    cutoffs: {
      BREAKFAST: map.get("cutoff.breakfast") || defaults.cutoffs.BREAKFAST,
      LUNCH: map.get("cutoff.lunch") || defaults.cutoffs.LUNCH,
      DINNER: map.get("cutoff.dinner") || defaults.cutoffs.DINNER,
    },
    weeklyTemplate,
    jwtExpiryMinutes: map.get("jwtExpiryMinutes") || defaults.jwtExpiryMinutes,
    pinPolicyMinLength: map.get("pinPolicyMinLength") || defaults.pinPolicyMinLength,
  };
  settingsCache = { ts: Date.now(), data };
  return data;
}

function parseTimeString(value: string | null | undefined) {
  if (!value) return null;
  const [hourStr, minuteStr] = value.split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  return { hour, minute };
}

function getTemplateForDate(dateStr: string, settings: any) {
  const [year, month, day] = dateStr.split("-").map((part) => Number(part));
  const dayOfWeek = new Date(year, month - 1, day).getDay();
  const template = settings?.weeklyTemplate || {};
  const dayTemplate = template.days?.[String(dayOfWeek)];
  if (dayTemplate) {
    return {
      isOfficeOpen: dayTemplate.isOfficeOpen ?? true,
      breakfastServed: dayTemplate.breakfastServed ?? true,
      lunchServed: dayTemplate.lunchServed ?? true,
      dinnerServed: dayTemplate.dinnerServed ?? true,
      breakfastCutoff: null,
      lunchCutoff: null,
      dinnerCutoff: null,
      note: null,
    };
  }
  if (template.sundayClosed && dayOfWeek === 0) {
    return {
      isOfficeOpen: false,
      breakfastServed: false,
      lunchServed: false,
      dinnerServed: false,
      breakfastCutoff: null,
      lunchCutoff: null,
      dinnerCutoff: null,
      note: null,
    };
  }
  return {
    isOfficeOpen: true,
    breakfastServed: true,
    lunchServed: true,
    dinnerServed: true,
    breakfastCutoff: null,
    lunchCutoff: null,
    dinnerCutoff: null,
    note: null,
  };
}

function mergeServiceDay(dateStr: string, record: any | undefined, settings: any) {
  const template = getTemplateForDate(dateStr, settings);
  if (!record) {
    return { date: dateStr, ...template };
  }
  return {
    date: record.date,
    isOfficeOpen: record.isOfficeOpen,
    breakfastServed: record.breakfastServed,
    lunchServed: record.lunchServed,
    dinnerServed: record.dinnerServed,
    breakfastCutoff: record.breakfastCutoff ?? template.breakfastCutoff,
    lunchCutoff: record.lunchCutoff ?? template.lunchCutoff,
    dinnerCutoff: record.dinnerCutoff ?? template.dinnerCutoff,
    note: record.note ?? template.note,
  };
}

async function getEffectiveServiceDay(dateStr: string) {
  const settings = await getSettingsSnapshot();
  const record = await prisma.serviceDay.findUnique({ where: { date: dateStr } });
  return mergeServiceDay(dateStr, record ?? undefined, settings);
}

function isMealServed(serviceDay: {
  isOfficeOpen: boolean;
  breakfastServed: boolean;
  lunchServed: boolean;
  dinnerServed: boolean;
}, mealType: MealType) {
  if (!serviceDay.isOfficeOpen) return false;
  if (mealType === MealType.BREAKFAST) return serviceDay.breakfastServed;
  if (mealType === MealType.LUNCH) return serviceDay.lunchServed;
  return serviceDay.dinnerServed;
}

function getCutoffDate(dateStr: string, mealType: MealType, serviceDay?: any, settings?: any): Date {
  const [year, month, day] = dateStr.split("-").map((part) => Number(part));
  const cutoffOverride =
    mealType === MealType.BREAKFAST
      ? parseTimeString(serviceDay?.breakfastCutoff)
      : mealType === MealType.LUNCH
        ? parseTimeString(serviceDay?.lunchCutoff)
        : parseTimeString(serviceDay?.dinnerCutoff);
  const baseCutoffLabel = settings?.cutoffs?.[mealType] || cutoffTimes[mealType].label;
  const baseCutoff = parseTimeString(baseCutoffLabel) ?? cutoffTimes[mealType];
  const cutoff = cutoffOverride ?? baseCutoff;
  return new Date(year, month - 1, day, cutoff.hour, cutoff.minute, 0, 0);
}

function getCutoffLabel(mealType: MealType, serviceDay?: any, settings?: any): string {
  const override =
    mealType === MealType.BREAKFAST
      ? serviceDay?.breakfastCutoff
      : mealType === MealType.LUNCH
        ? serviceDay?.lunchCutoff
        : serviceDay?.dinnerCutoff;
  const baseLabel = settings?.cutoffs?.[mealType] || cutoffTimes[mealType].label;
  return override || baseLabel;
}

function getDateRange(from: string, to: string): string[] {
  const [startYear, startMonth, startDay] = from.split("-").map((part) => Number(part));
  const [endYear, endMonth, endDay] = to.split("-").map((part) => Number(part));
  const startDate = new Date(startYear, startMonth - 1, startDay);
  const endDate = new Date(endYear, endMonth - 1, endDay);
  const days: string[] = [];
  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    days.push(formatLocalDate(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function getDayMask(dateStr: string): number {
  const [year, month, day] = dateStr.split("-").map((part) => Number(part));
  const dayOfWeek = new Date(year, month - 1, day).getDay();
  const indexMap = [6, 0, 1, 2, 3, 4, 5];
  return 1 << indexMap[dayOfWeek];
}

function preferenceApplies(preference: any, dateStr: string): boolean {
  if (!preference.active) return false;
  if (preference.startDate && dateStr < preference.startDate) return false;
  if (preference.endDate && dateStr > preference.endDate) return false;
  const mask = getDayMask(dateStr);
  return (preference.daysMask & mask) !== 0;
}

function findPreference(preferences: any[], dateStr: string): any | null {
  for (const pref of preferences) {
    if (preferenceApplies(pref, dateStr)) {
      return pref;
    }
  }
  return null;
}

async function logAudit(params: {
  actorId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  reason?: string | null;
  before?: any;
  after?: any;
}) {
  await prisma.auditLog.create({
    data: {
      actorId: params.actorId ?? null,
      action: params.action,
      entity: params.entity,
      entityId: params.entityId ?? null,
      reason: params.reason ?? null,
      before: params.before ? JSON.stringify(params.before) : null,
      after: params.after ? JSON.stringify(params.after) : null,
    },
  });
}

async function getEffectiveChoicesForUser(userId: string, from: string, to: string) {
  const settings = await getSettingsSnapshot();
  const dates = getDateRange(from, to);
  const [choices, preferences, serviceRecords, requests] = await Promise.all([
    prisma.mealChoice.findMany({
      where: {
        userId,
        date: {
          gte: normalizeDateOnly(from),
          lte: normalizeDateOnly(to),
        },
      },
    }),
    prisma.mealPreference.findMany({
      where: { userId, active: true },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.serviceDay.findMany({
      where: { date: { in: dates } },
    }),
    prisma.mealRequest.findMany({
      where: { userId, date: { in: dates } },
    }),
  ]);

  const choiceMap = new Map(
    choices.map((choice) => [
      `${formatDateOnly(choice.date)}|${choice.mealType}`,
      choice,
    ])
  );
  const serviceMap = new Map(serviceRecords.map((record) => [record.date, record]));
  const requestMap = new Map(
    requests.map((req) => [`${req.date}|${req.mealType}`, req])
  );
  const updatedByIds = Array.from(new Set(choices.map((choice) => choice.updatedById).filter(Boolean)));
  const updatedByList = updatedByIds.length
    ? await prisma.user.findMany({
        where: { id: { in: updatedByIds as string[] } },
        select: { id: true, role: true },
      })
    : [];
  const updatedByMap = new Map(updatedByList.map((user) => [user.id, user.role]));
  const prefsByMeal = new Map<MealType, any[]>();
  for (const pref of preferences) {
    const list = prefsByMeal.get(pref.mealType) || [];
    list.push(pref);
    prefsByMeal.set(pref.mealType, list);
  }

  const result = [];
  for (const dateStr of dates) {
    const serviceDay = mergeServiceDay(dateStr, serviceMap.get(dateStr), settings);
    for (const mealType of [MealType.BREAKFAST, MealType.LUNCH, MealType.DINNER]) {
      const officeOpen = serviceDay.isOfficeOpen !== false;
      const servedGlobal = isMealServed(serviceDay, mealType);
      const key = `${dateStr}|${mealType}`;
      const explicit = choiceMap.get(key);
      const request = requestMap.get(key);
      const cutoffLabel = getCutoffLabel(mealType, serviceDay, settings);
      const cutoffPassed = servedGlobal
        ? new Date() > getCutoffDate(dateStr, mealType, serviceDay, settings)
        : false;
      const updatedByRole = explicit?.updatedById ? updatedByMap.get(explicit.updatedById) : null;
      const overridden =
        !!explicit &&
        (updatedByRole === Role.HR_ADMIN || updatedByRole === Role.SUPER_ADMIN) &&
        explicit.updatedAt > getCutoffDate(dateStr, mealType, serviceDay, settings);
      if (!servedGlobal || !officeOpen) {
        result.push({
          date: dateStr,
          mealType,
          status: "NA",
          choiceStatus: "NA",
          wantMeal: request?.status === "APPROVED" ? true : null,
          defaultHintWantMeal: null,
          served: servedGlobal,
          servedGlobal,
          officeOpen,
          cutoffLabel,
          cutoffPassed,
          overridden: false,
          overriddenByRole: null,
          requestStatus: request?.status ?? null,
          requestReason: request?.decisionReason ?? null,
        });
        continue;
      }
      if (explicit) {
        result.push({
          date: dateStr,
          mealType,
          status: "EXPLICIT",
          choiceStatus: "EXPLICIT",
          wantMeal: explicit.wantMeal,
          defaultHintWantMeal: null,
          served: servedGlobal,
          servedGlobal,
          officeOpen,
          cutoffLabel,
          cutoffPassed,
          overridden,
          overriddenByRole: overridden ? updatedByRole : null,
          requestStatus: request?.status ?? null,
          requestReason: request?.decisionReason ?? null,
        });
        continue;
      }
      const prefs = prefsByMeal.get(mealType) || [];
      const pref = findPreference(prefs, dateStr);
      if (pref) {
        result.push({
          date: dateStr,
          mealType,
          status: "DEFAULT",
          choiceStatus: "DEFAULT",
          wantMeal: null,
          defaultHintWantMeal: pref.defaultWantMeal,
          served: servedGlobal,
          servedGlobal,
          officeOpen,
          cutoffLabel,
          cutoffPassed,
          overridden: false,
          overriddenByRole: null,
          requestStatus: request?.status ?? null,
          requestReason: request?.decisionReason ?? null,
        });
      } else {
        result.push({
          date: dateStr,
          mealType,
          status: "NOT_SET",
          choiceStatus: "NOT_SET",
          wantMeal: null,
          defaultHintWantMeal: null,
          served: servedGlobal,
          servedGlobal,
          officeOpen,
          cutoffLabel,
          cutoffPassed,
          overridden: false,
          overriddenByRole: null,
          requestStatus: request?.status ?? null,
          requestReason: request?.decisionReason ?? null,
        });
      }
    }
  }

  return result;
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

router.get("/service-days", authMiddleware, async (req, res) => {
  const schema = z.object({
    from: dateOnlySchema,
    to: dateOnlySchema,
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid date range" });
  }

  const { from, to } = parsed.data;
  const settings = await getSettingsSnapshot();
  const records = await prisma.serviceDay.findMany({
    where: {
      date: {
        gte: from,
        lte: to,
      },
    },
    orderBy: { date: "asc" },
  });
  const recordMap = new Map(records.map((record) => [record.date, record]));
  const days = [];
  for (const dateStr of getDateRange(from, to)) {
    const merged = mergeServiceDay(dateStr, recordMap.get(dateStr), settings);
    days.push(merged);
  }

  return res.json(days);
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

  const { from, to } = parsed.data;
  const effective = await getEffectiveChoicesForUser(req.user.id, from, to);
  return res.json(effective);
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
  const settings = await getSettingsSnapshot();
  const serviceDay = await getEffectiveServiceDay(date);
  if (!isMealServed(serviceDay, mealType)) {
    return res.status(409).json({ error: "Meal not served" });
  }
  const cutoffDate = getCutoffDate(date, mealType, serviceDay, settings);
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

router.post("/meal-requests", authMiddleware, async (req, res) => {
  const schema = z.object({
    date: dateOnlySchema,
    mealType: z.nativeEnum(MealType),
    note: z.string().trim().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success || !req.user) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const { date, mealType, note } = parsed.data;
  const settings = await getSettingsSnapshot();
  const serviceDay = await getEffectiveServiceDay(date);
  if (!serviceDay.isOfficeOpen) {
    return res.status(409).json({ error: "Office closed" });
  }
  if (isMealServed(serviceDay, mealType)) {
    return res.status(409).json({ error: "Meal already served; no request needed" });
  }

  const cutoffDate = getCutoffDate(date, mealType, serviceDay, settings);
  const isAfterCutoff = new Date() > cutoffDate;
  const isHrOverride = req.user.role === Role.HR_ADMIN || req.user.role === Role.SUPER_ADMIN;
  if (isAfterCutoff && !isHrOverride) {
    return res.status(403).json({ error: "Cutoff passed" });
  }
  if (isAfterCutoff && isHrOverride && !note) {
    return res.status(400).json({ error: "Override reason required" });
  }

  const existing = await prisma.mealRequest.findUnique({
    where: {
      userId_date_mealType: {
        userId: req.user.id,
        date,
        mealType,
      },
    },
  });

  if (
    existing &&
    (existing.status === MealRequestStatus.APPROVED || existing.status === MealRequestStatus.REJECTED) &&
    !isHrOverride
  ) {
    return res.status(409).json({ error: "Request already decided" });
  }

  const request = await prisma.mealRequest.upsert({
    where: {
      userId_date_mealType: {
        userId: req.user.id,
        date,
        mealType,
      },
    },
    create: {
      userId: req.user.id,
      date,
      mealType,
      status: MealRequestStatus.PENDING,
      note: note ?? null,
    },
    update: {
      status: MealRequestStatus.PENDING,
      note: note ?? null,
      decidedById: null,
      decidedAt: null,
      decisionReason: null,
    },
  });

  await logAudit({
    actorId: req.user.id,
    action: "CREATE_MEAL_REQUEST",
    entity: "MealRequest",
    entityId: request.id,
    reason: note ?? null,
    before: existing ?? null,
    after: request,
  });

  return res.json(request);
});

router.delete("/meal-requests", authMiddleware, async (req, res) => {
  const schema = z.object({
    date: dateOnlySchema,
    mealType: z.nativeEnum(MealType),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success || !req.user) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const { date, mealType } = parsed.data;
  const existing = await prisma.mealRequest.findUnique({
    where: {
      userId_date_mealType: {
        userId: req.user.id,
        date,
        mealType,
      },
    },
  });

  if (!existing) {
    return res.status(404).json({ error: "Request not found" });
  }
  if (existing.status !== MealRequestStatus.PENDING) {
    return res.status(409).json({ error: "Only pending requests can be canceled" });
  }

  const updated = await prisma.mealRequest.update({
    where: { id: existing.id },
    data: { status: MealRequestStatus.CANCELLED },
  });

  await logAudit({
    actorId: req.user.id,
    action: "CANCEL_MEAL_REQUEST",
    entity: "MealRequest",
    entityId: updated.id,
    before: existing,
    after: updated,
  });

  return res.json(updated);
});

router.get("/me/meal-requests", authMiddleware, async (req, res) => {
  const schema = z.object({
    from: dateOnlySchema,
    to: dateOnlySchema,
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success || !req.user) {
    return res.status(400).json({ error: "Invalid date range" });
  }

  const { from, to } = parsed.data;
  const requests = await prisma.mealRequest.findMany({
    where: {
      userId: req.user.id,
      date: {
        gte: from,
        lte: to,
      },
    },
    orderBy: [{ date: "asc" }, { mealType: "asc" }],
  });

  return res.json(requests);
});

router.delete("/choice", authMiddleware, async (req, res) => {
  const schema = z.object({
    date: dateOnlySchema,
    mealType: z.nativeEnum(MealType),
    reason: z.string().trim().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success || !req.user) {
    return res.status(400).json({ error: "Invalid payload" });
  }

  const { date, mealType, reason } = parsed.data;
  const dateValue = normalizeDateOnly(date);
  const settings = await getSettingsSnapshot();
  const serviceDay = await getEffectiveServiceDay(date);
  if (!isMealServed(serviceDay, mealType)) {
    return res.status(409).json({ error: "Meal not served" });
  }
  const cutoffDate = getCutoffDate(date, mealType, serviceDay, settings);
  const isAfterCutoff = new Date() > cutoffDate;
  const isHrOverride = req.user.role === Role.HR_ADMIN || req.user.role === Role.SUPER_ADMIN;
  if (isAfterCutoff && !isHrOverride) {
    return res.status(403).json({ error: "Cutoff passed" });
  }
  if (isAfterCutoff && isHrOverride && !reason) {
    return res.status(400).json({ error: "Override reason required" });
  }

  const existing = await prisma.mealChoice.findUnique({
    where: {
      userId_date_mealType: {
        userId: req.user.id,
        date: dateValue,
        mealType,
      },
    },
  });

  if (existing) {
    await prisma.mealChoice.delete({
      where: { id: existing.id },
    });
    await logAudit({
      actorId: req.user.id,
      action: "DELETE_CHOICE",
      entity: "MealChoice",
      entityId: existing.id,
      reason: reason ?? null,
      before: existing,
      after: null,
    });
  }

  const effective = await getEffectiveChoicesForUser(req.user.id, date, date);
  const updated = effective.find((item) => item.mealType === mealType);
  return res.json({ ok: true, choice: updated });
});

router.post(
  "/staff/choice",
  authMiddleware,
  requireRole([Role.SUPERVISOR, Role.ADMIN, Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (req, res) => {
    const schema = z.object({
      employeeId: z.string().trim().min(1),
      date: dateOnlySchema,
      mealType: z.nativeEnum(MealType),
      wantMeal: z.boolean(),
      reason: z.string().trim().optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success || !req.user) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const { employeeId, date, mealType, wantMeal, reason } = parsed.data;
    const dateValue = normalizeDateOnly(date);
    const settings = await getSettingsSnapshot();
    const serviceDay = await getEffectiveServiceDay(date);
    if (!isMealServed(serviceDay, mealType)) {
      return res.status(409).json({ error: "Meal not served" });
    }
    const cutoffDate = getCutoffDate(date, mealType, serviceDay, settings);
    const now = new Date();
    const isAfterCutoff = now > cutoffDate;
    const isHrOverride = req.user.role === Role.HR_ADMIN || req.user.role === Role.SUPER_ADMIN;
    if (isAfterCutoff && !isHrOverride) {
      return res.status(403).json({ error: "Cutoff passed" });
    }
    if (isAfterCutoff && isHrOverride && !reason) {
      return res.status(400).json({ error: "Override reason required" });
    }

    const targetUser = await prisma.user.findFirst({
      where: { employeeId, active: true },
    });

    if (!targetUser) {
      return res.status(404).json({ error: "User not found" });
    }

    const source = req.user.role === Role.SUPERVISOR ? Source.SUPERVISOR : Source.ADMIN;

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

    if (isAfterCutoff && isHrOverride) {
      await logAudit({
        actorId: req.user.id,
        action: "MEAL_CHOICE_OVERRIDE",
        entity: "MealChoice",
        entityId: choice.id,
        reason: reason ?? null,
        after: { userId: targetUser.id, date, mealType, wantMeal },
      });
    }

    return res.json({
      id: choice.id,
      employeeId: targetUser.employeeId,
      date,
      mealType: choice.mealType,
      wantMeal: choice.wantMeal,
      source: choice.source,
      overridden: isAfterCutoff && isHrOverride,
    });
  }
);

router.get(
  "/admin/meal-requests",
  authMiddleware,
  requireRole([Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (req, res) => {
    const schema = z.object({
      from: dateOnlySchema,
      to: dateOnlySchema,
      status: z.nativeEnum(MealRequestStatus).optional(),
    });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid date range" });
    }

    const { from, to, status } = parsed.data;
    const requests = await prisma.mealRequest.findMany({
      where: {
        date: {
          gte: from,
          lte: to,
        },
        ...(status ? { status } : {}),
      },
      include: {
        user: {
          select: { employeeId: true, name: true, dept: true },
        },
      },
      orderBy: [{ date: "asc" }, { mealType: "asc" }],
    });

    return res.json(requests);
  }
);

router.post(
  "/admin/meal-requests/decide",
  authMiddleware,
  requireRole([Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (req, res) => {
    const schema = z.object({
      id: z.string().min(1),
      decision: z.enum(["APPROVE", "REJECT"]),
      reason: z.string().trim().min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success || !req.user) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const { id, decision, reason } = parsed.data;
    const existing = await prisma.mealRequest.findUnique({
      where: { id },
    });
    if (!existing) {
      return res.status(404).json({ error: "Request not found" });
    }
    if (existing.status === MealRequestStatus.APPROVED || existing.status === MealRequestStatus.REJECTED) {
      return res.status(409).json({ error: "Request already decided" });
    }

    if (decision === "APPROVE") {
      const updated = await prisma.mealRequest.update({
        where: { id: existing.id },
        data: {
          status: MealRequestStatus.APPROVED,
          decidedById: req.user.id,
          decidedAt: new Date(),
          decisionReason: reason,
        },
      });

      const choice = await prisma.mealChoice.upsert({
        where: {
          userId_date_mealType: {
            userId: existing.userId,
            date: normalizeDateOnly(existing.date),
            mealType: existing.mealType,
          },
        },
        create: {
          userId: existing.userId,
          date: normalizeDateOnly(existing.date),
          mealType: existing.mealType,
          wantMeal: true,
          source: Source.ADMIN,
          updatedById: req.user.id,
        },
        update: {
          wantMeal: true,
          source: Source.ADMIN,
          updatedById: req.user.id,
        },
      });

      await logAudit({
        actorId: req.user.id,
        action: "APPROVE_MEAL_REQUEST",
        entity: "MealRequest",
        entityId: updated.id,
        reason,
        before: existing,
        after: updated,
      });
      await logAudit({
        actorId: req.user.id,
        action: "AUTO_CREATE_CHOICE_FROM_REQUEST",
        entity: "MealChoice",
        entityId: choice.id,
        reason,
        after: {
          userId: existing.userId,
          date: existing.date,
          mealType: existing.mealType,
          wantMeal: true,
        },
      });

      return res.json(updated);
    }

    const updated = await prisma.mealRequest.update({
      where: { id: existing.id },
      data: {
        status: MealRequestStatus.REJECTED,
        decidedById: req.user.id,
        decidedAt: new Date(),
        decisionReason: reason,
      },
    });

    await logAudit({
      actorId: req.user.id,
      action: "REJECT_MEAL_REQUEST",
      entity: "MealRequest",
      entityId: updated.id,
      reason,
      before: existing,
      after: updated,
    });

    return res.json(updated);
  }
);

router.get(
  "/admin/users",
  authMiddleware,
  requireRole([Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (req, res) => {
    const query = typeof req.query.q === "string" ? req.query.q.trim() : "";
    const users = await prisma.user.findMany({
      where: {
        ...(query
          ? {
              OR: [
                { employeeId: { contains: query, mode: "insensitive" } },
                { name: { contains: query, mode: "insensitive" } },
                { dept: { contains: query, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { employeeId: "asc" },
      select: {
        id: true,
        employeeId: true,
        name: true,
        dept: true,
        role: true,
        active: true,
      },
    });

    return res.json(users);
  }
);

router.post(
  "/admin/users",
  authMiddleware,
  requireRole([Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (req, res) => {
    const schema = z.object({
      employeeId: z.string().trim().min(1),
      name: z.string().trim().min(1),
      dept: z.string().trim().optional(),
      role: z.nativeEnum(Role),
      pin: z.string().trim().min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success || !req.user) {
      return res.status(400).json({ error: "Invalid payload" });
    }
    const data = parsed.data;
    const pinHash = await bcrypt.hash(data.pin, 10);
    const deptValue = data.dept?.trim() ? data.dept.trim() : null;
    const user = await prisma.user.create({
      data: {
        employeeId: data.employeeId,
        name: data.name,
        dept: deptValue,
        role: data.role,
        pinHash,
        active: true,
      },
      select: {
        id: true,
        employeeId: true,
        name: true,
        dept: true,
        role: true,
        active: true,
      },
    });
    await logAudit({
      actorId: req.user.id,
      action: "CREATE_USER",
      entity: "User",
      entityId: user.id,
      after: { employeeId: user.employeeId, role: user.role, dept: user.dept, active: user.active },
    });
    return res.json(user);
  }
);

router.put(
  "/admin/users/:id",
  authMiddleware,
  requireRole([Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (req, res) => {
    const schema = z.object({
      name: z.string().trim().optional(),
      dept: z.string().trim().nullable().optional(),
      role: z.nativeEnum(Role).optional(),
      active: z.boolean().optional(),
      reason: z.string().trim().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success || !req.user) {
      return res.status(400).json({ error: "Invalid payload" });
    }
    const existing = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!existing) {
      return res.status(404).json({ error: "User not found" });
    }
    const data = parsed.data;
    const deptValue = data.dept !== undefined ? (data.dept?.trim() ? data.dept.trim() : null) : undefined;
    const user = await prisma.user.update({
      where: { id: existing.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(deptValue !== undefined ? { dept: deptValue } : {}),
        ...(data.role !== undefined ? { role: data.role } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
      },
      select: {
        id: true,
        employeeId: true,
        name: true,
        dept: true,
        role: true,
        active: true,
      },
    });
    await logAudit({
      actorId: req.user.id,
      action: "UPDATE_USER",
      entity: "User",
      entityId: user.id,
      reason: data.reason ?? null,
      before: { name: existing.name, dept: existing.dept, role: existing.role, active: existing.active },
      after: { name: user.name, dept: user.dept, role: user.role, active: user.active },
    });
    return res.json(user);
  }
);

router.post(
  "/admin/users/:id/reset-pin",
  authMiddleware,
  requireRole([Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (req, res) => {
    const schema = z.object({
      pin: z.string().trim().min(1),
      reason: z.string().trim().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success || !req.user) {
      return res.status(400).json({ error: "Invalid payload" });
    }
    const user = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    const pinHash = await bcrypt.hash(parsed.data.pin, 10);
    await prisma.user.update({
      where: { id: user.id },
      data: { pinHash },
    });
    await logAudit({
      actorId: req.user.id,
      action: "RESET_PIN",
      entity: "User",
      entityId: user.id,
      reason: parsed.data.reason ?? null,
    });
    return res.json({ ok: true });
  }
);

router.post(
  "/admin/users/import",
  authMiddleware,
  requireRole([Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (req, res) => {
    const schema = z.object({
      users: z.array(
        z.object({
          employeeId: z.string().trim().min(1),
          name: z.string().trim().min(1),
          dept: z.string().trim().optional(),
          role: z.nativeEnum(Role),
          pin: z.string().trim().min(1),
        })
      ),
      reason: z.string().trim().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success || !req.user) {
      return res.status(400).json({ error: "Invalid payload" });
    }
    const results = [];
    for (const item of parsed.data.users) {
      const pinHash = await bcrypt.hash(item.pin, 10);
      const deptValue = item.dept?.trim() ? item.dept.trim() : null;
      const user = await prisma.user.upsert({
        where: { employeeId: item.employeeId },
        create: {
          employeeId: item.employeeId,
          name: item.name,
          dept: deptValue,
          role: item.role,
          pinHash,
          active: true,
        },
        update: {
          name: item.name,
          dept: deptValue,
          role: item.role,
          pinHash,
          active: true,
        },
      });
      await logAudit({
        actorId: req.user.id,
        action: "IMPORT_USER",
        entity: "User",
        entityId: user.id,
        reason: parsed.data.reason ?? null,
        after: { employeeId: user.employeeId, role: user.role, dept: user.dept, active: user.active },
      });
      results.push(user);
    }
    return res.json({ ok: true, count: results.length });
  }
);

router.put(
  "/admin/supervisor-assignments",
  authMiddleware,
  requireRole([Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (req, res) => {
    const schema = z.object({
      employeeId: z.string().trim().min(1),
      supervisorEmployeeId: z.string().trim().nullable(),
      reason: z.string().trim().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success || !req.user) {
      return res.status(400).json({ error: "Invalid payload" });
    }
    const employee = await prisma.user.findFirst({
      where: { employeeId: parsed.data.employeeId },
    });
    if (!employee) {
      return res.status(404).json({ error: "Employee not found" });
    }
    const supervisor = parsed.data.supervisorEmployeeId
      ? await prisma.user.findFirst({ where: { employeeId: parsed.data.supervisorEmployeeId } })
      : null;

    if (parsed.data.supervisorEmployeeId && !supervisor) {
      return res.status(404).json({ error: "Supervisor not found" });
    }

    const existing = await prisma.supervisorAssignment.findUnique({
      where: { employeeId: employee.id },
    });

    if (!parsed.data.supervisorEmployeeId) {
      if (existing) {
        await prisma.supervisorAssignment.delete({ where: { employeeId: employee.id } });
      }
      await logAudit({
        actorId: req.user.id,
        action: "UNASSIGN_SUPERVISOR",
        entity: "SupervisorAssignment",
        entityId: existing?.id ?? null,
        reason: parsed.data.reason ?? null,
        before: existing,
        after: null,
      });
      return res.json({ ok: true });
    }

    const assignment = await prisma.supervisorAssignment.upsert({
      where: { employeeId: employee.id },
      create: {
        employeeId: employee.id,
        supervisorId: supervisor!.id,
      },
      update: {
        supervisorId: supervisor!.id,
      },
    });
    await logAudit({
      actorId: req.user.id,
      action: "ASSIGN_SUPERVISOR",
      entity: "SupervisorAssignment",
      entityId: assignment.id,
      reason: parsed.data.reason ?? null,
      after: assignment,
    });
    return res.json(assignment);
  }
);

router.get(
  "/admin/preferences",
  authMiddleware,
  requireRole([Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (req, res) => {
    const userId = typeof req.query.userId === "string" ? req.query.userId : null;
    if (!userId) {
      return res.status(400).json({ error: "Missing userId" });
    }
    const preferences = await prisma.mealPreference.findMany({
      where: { userId },
      orderBy: { updatedAt: "desc" },
    });
    return res.json(preferences);
  }
);

router.post(
  "/admin/preferences/apply",
  authMiddleware,
  requireRole([Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (req, res) => {
    const ruleSchema = z.object({
      mealType: z.nativeEnum(MealType),
      defaultWantMeal: z.boolean().optional(),
      daysMask: z.number().int().min(0).max(127).optional(),
      startDate: dateOnlySchema.optional().nullable(),
      endDate: dateOnlySchema.optional().nullable(),
      active: z.boolean().optional(),
    });
    const schema = z.object({
      scope: z.object({
        userIds: z.array(z.string()).optional(),
        dept: z.string().optional(),
        allActive: z.boolean().optional(),
      }),
      rules: z.array(ruleSchema).min(1),
      reason: z.string().trim().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success || !req.user) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const { scope, rules, reason } = parsed.data;
    if (!scope.userIds && !scope.dept && !scope.allActive) {
      return res.status(400).json({ error: "Missing scope" });
    }

    const users = await prisma.user.findMany({
      where: {
        active: true,
        ...(scope.userIds ? { id: { in: scope.userIds } } : {}),
        ...(scope.dept ? { dept: scope.dept } : {}),
      },
      select: { id: true },
    });

    let createdCount = 0;
    let updatedCount = 0;

    for (const rule of rules) {
      const isActive = rule.active !== undefined ? rule.active : true;
      if (!isActive) {
        const result = await prisma.mealPreference.updateMany({
          where: {
            userId: { in: users.map((user) => user.id) },
            mealType: rule.mealType,
            active: true,
          },
          data: { active: false, updatedById: req.user.id },
        });
        updatedCount += result.count;
        continue;
      }
      if (rule.defaultWantMeal === undefined) {
        return res.status(400).json({ error: "defaultWantMeal required for active rule" });
      }
      for (const user of users) {
        await prisma.mealPreference.create({
          data: {
            userId: user.id,
            mealType: rule.mealType,
            defaultWantMeal: rule.defaultWantMeal,
            daysMask: rule.daysMask ?? 127,
            startDate: rule.startDate ?? null,
            endDate: rule.endDate ?? null,
            active: true,
            updatedById: req.user.id,
          },
        });
        createdCount += 1;
      }
    }

    await logAudit({
      actorId: req.user.id,
      action: "APPLY_DEFAULTS",
      entity: "MealPreference",
      reason: reason ?? null,
      after: { createdCount, updatedCount },
    });

    return res.json({ ok: true, createdCount, updatedCount });
  }
);

router.post(
  "/kiosk/checkin",
  authMiddleware,
  requireRole([Role.GROUND_STAFF, Role.SUPER_ADMIN]),
  async (req, res) => {
    const schema = z.object({
      employeeId: z.string().trim().min(1),
      date: dateOnlySchema.optional(),
      mealType: z.nativeEnum(MealType),
      note: z.string().trim().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success || !req.user) {
      return res.status(400).json({ error: "Invalid payload" });
    }
    const today = formatLocalDate(new Date());
    const date = parsed.data.date ?? today;
    if (date !== today) {
      return res.status(400).json({ error: "Date must be today" });
    }
    const user = await prisma.user.findFirst({ where: { employeeId: parsed.data.employeeId } });
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }
    const serviceDay = await getEffectiveServiceDay(date);
    if (!isMealServed(serviceDay, parsed.data.mealType)) {
      return res.status(409).json({ error: "Meal not served" });
    }
    const existing = await prisma.mealCheckin.findUnique({
      where: {
        userId_date_mealType: {
          userId: user.id,
          date,
          mealType: parsed.data.mealType,
        },
      },
    });
    if (existing) {
      const checkedInCount = await prisma.mealCheckin.count({
        where: { date, mealType: parsed.data.mealType },
      });
      const recent = await prisma.mealCheckin.findMany({
        where: { date, mealType: parsed.data.mealType },
        orderBy: { takenAt: "desc" },
        take: 5,
        include: { user: { select: { employeeId: true } } },
      });
      return res.json({
        ok: false,
        message: "Already checked in",
        totals: { checkedInCount },
        recent: recent.map((item) => ({ employeeId: item.user.employeeId, takenAt: item.takenAt })),
      });
    }

    const checkin = await prisma.mealCheckin.create({
      data: {
        userId: user.id,
        date,
        mealType: parsed.data.mealType,
        note: parsed.data.note ?? null,
        recordedById: req.user.id,
      },
    });
    const checkedInCount = await prisma.mealCheckin.count({
      where: { date, mealType: parsed.data.mealType },
    });
    await logAudit({
      actorId: req.user.id,
      action: "CHECKIN",
      entity: "MealCheckin",
      entityId: checkin.id,
      after: { userId: user.id, date, mealType: parsed.data.mealType },
    });
    const recent = await prisma.mealCheckin.findMany({
      where: { date, mealType: parsed.data.mealType },
      orderBy: { takenAt: "desc" },
      take: 5,
      include: { user: { select: { employeeId: true } } },
    });
    return res.json({
      ok: true,
      totals: { checkedInCount },
      recent: recent.map((item) => ({ employeeId: item.user.employeeId, takenAt: item.takenAt })),
    });
  }
);

router.get(
  "/kiosk/status",
  authMiddleware,
  requireRole([Role.GROUND_STAFF, Role.SUPER_ADMIN]),
  async (req, res) => {
    const schema = z.object({
      date: dateOnlySchema.optional(),
      mealType: z.nativeEnum(MealType),
    });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid payload" });
    }
    const date = parsed.data.date ?? formatLocalDate(new Date());
    const serviceDay = await getEffectiveServiceDay(date);
    const served = isMealServed(serviceDay, parsed.data.mealType);
    const checkedInCount = await prisma.mealCheckin.count({
      where: { date, mealType: parsed.data.mealType },
    });
    const recent = await prisma.mealCheckin.findMany({
      where: { date, mealType: parsed.data.mealType },
      orderBy: { takenAt: "desc" },
      take: 5,
      include: { user: { select: { employeeId: true } } },
    });
    return res.json({
      date,
      mealType: parsed.data.mealType,
      served,
      isOfficeOpen: serviceDay.isOfficeOpen,
      checkedInCount,
      recent: recent.map((item) => ({ employeeId: item.user.employeeId, takenAt: item.takenAt })),
    });
  }
);

router.put(
  "/admin/service-day",
  authMiddleware,
  requireRole([Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (req, res) => {
    const schema = z.object({
      date: dateOnlySchema,
      isOfficeOpen: z.boolean(),
      breakfastServed: z.boolean(),
      lunchServed: z.boolean(),
      dinnerServed: z.boolean(),
      breakfastCutoff: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      lunchCutoff: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      dinnerCutoff: z.string().regex(/^\d{2}:\d{2}$/).optional(),
      note: z.string().max(200).optional(),
    });

    const parsed = schema.safeParse(req.body);
    if (!parsed.success || !req.user) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const data = parsed.data;
    const serviceDay = await prisma.serviceDay.upsert({
      where: { date: data.date },
      create: {
        date: data.date,
        isOfficeOpen: data.isOfficeOpen,
        breakfastServed: data.breakfastServed,
        lunchServed: data.lunchServed,
        dinnerServed: data.dinnerServed,
        breakfastCutoff: data.breakfastCutoff ?? null,
        lunchCutoff: data.lunchCutoff ?? null,
        dinnerCutoff: data.dinnerCutoff ?? null,
        note: data.note ?? null,
        updatedById: req.user.id,
      },
      update: {
        isOfficeOpen: data.isOfficeOpen,
        breakfastServed: data.breakfastServed,
        lunchServed: data.lunchServed,
        dinnerServed: data.dinnerServed,
        breakfastCutoff: data.breakfastCutoff ?? null,
        lunchCutoff: data.lunchCutoff ?? null,
        dinnerCutoff: data.dinnerCutoff ?? null,
        note: data.note ?? null,
        updatedById: req.user.id,
      },
    });

    await logAudit({
      actorId: req.user.id,
      action: "UPDATE_SERVICE_DAY",
      entity: "ServiceDay",
      entityId: serviceDay.date,
      after: serviceDay,
    });
    return res.json(serviceDay);
  }
);

router.post(
  "/admin/service-days/apply-template",
  authMiddleware,
  requireRole([Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (req, res) => {
    const schema = z.object({
      from: dateOnlySchema.optional(),
      to: dateOnlySchema.optional(),
      templateName: z.string().optional(),
      days: z.number().int().min(1).max(365).optional(),
      startDate: dateOnlySchema.optional(),
      overwriteExisting: z.boolean().optional(),
      keepSundaysClosed: z.boolean().optional(),
      template: z
        .object({
          officeOpen: z.boolean(),
          breakfastServed: z.boolean(),
          lunchServed: z.boolean(),
          dinnerServed: z.boolean(),
        })
        .optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success || !req.user) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const { from, to, days, startDate, overwriteExisting, keepSundaysClosed, template } = parsed.data;
    const settings = await getSettingsSnapshot();
    const resolvedStart = startDate || from || formatLocalDate(new Date());
    const resolvedDays = days ?? (from && to ? getDateRange(from, to).length : null);
    if (!resolvedDays) {
      return res.status(400).json({ error: "Invalid date range" });
    }
    const startParts = resolvedStart.split("-").map((part) => Number(part));
    const startDateObj = new Date(startParts[0], startParts[1] - 1, startParts[2]);
    const endDateObj = new Date(startDateObj);
    endDateObj.setDate(endDateObj.getDate() + resolvedDays - 1);
    if (endDateObj < startDateObj) {
      return res.status(400).json({ error: "Invalid date range" });
    }
    const actions = [];
    const cursor = new Date(startDateObj);
    const existingRows = await prisma.serviceDay.findMany({
      where: {
        date: {
          gte: formatLocalDate(startDateObj),
          lte: formatLocalDate(endDateObj),
        },
      },
      select: { date: true, updatedById: true, note: true },
    });
    const existingMap = new Map(
      existingRows.map((row) => [row.date, { updatedById: row.updatedById, note: row.note }])
    );
    const templateUpdatedById = overwriteExisting ? req.user.id : null;
    let updatedCount = 0;
    let skippedCount = 0;
    while (cursor <= endDateObj) {
      const dateStr = formatLocalDate(cursor);
      const existing = existingMap.get(dateStr);
      const isManual =
        !!existing &&
        ((existing.updatedById && existing.updatedById.length > 0) ||
          (existing.note && existing.note.trim().length > 0));
      const shouldSkip = !overwriteExisting && isManual;
      if (shouldSkip) {
        skippedCount += 1;
      } else {
        let resolvedTemplate = template ? { ...template } : getTemplateForDate(dateStr, settings);
        if (template) {
          const dayOfWeek = cursor.getDay();
          if (keepSundaysClosed && dayOfWeek === 0) {
            resolvedTemplate = {
              officeOpen: false,
              breakfastServed: false,
              lunchServed: false,
              dinnerServed: false,
            };
          }
        }
        actions.push(
          prisma.serviceDay.upsert({
            where: { date: dateStr },
            create: {
              date: dateStr,
              isOfficeOpen: resolvedTemplate.officeOpen,
              breakfastServed: resolvedTemplate.breakfastServed,
              lunchServed: resolvedTemplate.lunchServed,
              dinnerServed: resolvedTemplate.dinnerServed,
              updatedById: templateUpdatedById,
            },
            update: {
              isOfficeOpen: resolvedTemplate.officeOpen,
              breakfastServed: resolvedTemplate.breakfastServed,
              lunchServed: resolvedTemplate.lunchServed,
              dinnerServed: resolvedTemplate.dinnerServed,
              updatedById: templateUpdatedById,
            },
          })
        );
        updatedCount += 1;
      }
      cursor.setDate(cursor.getDate() + 1);
    }

    if (actions.length) {
      await prisma.$transaction(actions);
    }
    await logAudit({
      actorId: req.user.id,
      action: "APPLY_SERVICE_DAY_TEMPLATE",
      entity: "ServiceDay",
      reason: `Applied weekly template for next ${resolvedDays} days`,
      after: {
        startDate: resolvedStart,
        endDate: formatLocalDate(endDateObj),
        days: resolvedDays,
        updatedCount,
        skippedCount,
        overwriteExisting: overwriteExisting === true,
        keepSundaysClosed: keepSundaysClosed === true,
      },
    });
    return res.json({
      ok: true,
      updatedCount,
      skippedCount,
      startDate: resolvedStart,
      endDate: formatLocalDate(endDateObj),
    });
  }
);

router.get(
  "/admin/settings",
  authMiddleware,
  requireRole([Role.SUPER_ADMIN]),
  async (_req, res) => {
    const settings = await getSettingsSnapshot();
    return res.json(settings);
  }
);

router.put(
  "/admin/settings",
  authMiddleware,
  requireRole([Role.SUPER_ADMIN]),
  async (req, res) => {
    const schema = z.object({
      settings: z.record(z.string()),
      reason: z.string().trim().min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success || !req.user) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const allowedKeys = new Set([
      "timezone",
      "cutoff.breakfast",
      "cutoff.lunch",
      "cutoff.dinner",
      "weeklyTemplate",
    ]);
    const entries = Object.entries(parsed.data.settings).filter(([key]) => allowedKeys.has(key));
    if (!entries.length) {
      return res.status(400).json({ error: "No valid settings provided" });
    }

    const existing = await prisma.appSetting.findMany({
      where: { key: { in: entries.map(([key]) => key) } },
    });
    const before = Object.fromEntries(existing.map((item) => [item.key, item.value]));

    for (const [key, value] of entries) {
      if (key === "weeklyTemplate") {
        try {
          JSON.parse(value);
        } catch {
          return res.status(400).json({ error: "weeklyTemplate must be valid JSON" });
        }
      }
    }

    await prisma.$transaction(
      entries.map(([key, value]) =>
        prisma.appSetting.upsert({
          where: { key },
          create: { key, value, updatedById: req.user.id },
          update: { value, updatedById: req.user.id },
        })
      )
    );

    settingsCache = null;
    const after = Object.fromEntries(entries.map(([key, value]) => [key, value]));
    await logAudit({
      actorId: req.user.id,
      action: "UPDATE_SETTINGS",
      entity: "AppSetting",
      reason: parsed.data.reason,
      before,
      after,
    });

    const settings = await getSettingsSnapshot();
    return res.json(settings);
  }
);

router.get(
  "/users",
  authMiddleware,
  requireRole([Role.SUPERVISOR, Role.ADMIN, Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (_req, res) => {
    const reqUser = _req.user;
    if (!reqUser) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    let userIds: string[] | null = null;
    if (reqUser.role === Role.SUPERVISOR) {
      const assignments = await prisma.supervisorAssignment.findMany({
        where: { supervisorId: reqUser.id },
        select: { employeeId: true },
      });
      userIds = [reqUser.id, ...assignments.map((item) => item.employeeId)];
    } else if (reqUser.role === Role.ADMIN || reqUser.role === Role.HR_ADMIN || reqUser.role === Role.SUPER_ADMIN) {
      userIds = null;
    } else {
      userIds = [reqUser.id];
    }

    const users = await prisma.user.findMany({
      where: {
        active: true,
        ...(userIds ? { id: { in: userIds } } : {}),
      },
      orderBy: { employeeId: "asc" },
      select: {
        id: true,
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
  requireRole([Role.SUPERVISOR, Role.ADMIN, Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (req, res) => {
    const parsed = dateOnlySchema.safeParse(req.query.date);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid date" });
    }

    const dateStr = parsed.data;
    const dateValue = normalizeDateOnly(dateStr);
    const serviceDay = await getEffectiveServiceDay(dateStr);
    const served = {
      BREAKFAST: isMealServed(serviceDay, MealType.BREAKFAST),
      LUNCH: isMealServed(serviceDay, MealType.LUNCH),
      DINNER: isMealServed(serviceDay, MealType.DINNER),
    };

    const users = await prisma.user.findMany({
      where: { active: true },
      select: { id: true, dept: true },
    });

    const [choices, preferences, approvedRequests] = await Promise.all([
      prisma.mealChoice.findMany({
        where: { date: dateValue },
      }),
      prisma.mealPreference.findMany({
        where: { userId: { in: users.map((user) => user.id) }, active: true },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.mealRequest.findMany({
        where: { date: dateStr, status: MealRequestStatus.APPROVED },
        select: { mealType: true },
      }),
    ]);

    const choiceMap = new Map(
      choices.map((choice) => [`${choice.userId}|${choice.mealType}`, choice])
    );
    const prefsByUserMeal = new Map<string, any[]>();
    for (const pref of preferences) {
      const key = `${pref.userId}|${pref.mealType}`;
      const list = prefsByUserMeal.get(key) || [];
      list.push(pref);
      prefsByUserMeal.set(key, list);
    }

    const counts: any = {
      BREAKFAST: served.BREAKFAST ? { yes: 0, no: 0, notSet: 0 } : null,
      LUNCH: served.LUNCH ? { yes: 0, no: 0, notSet: 0 } : null,
      DINNER: served.DINNER ? { yes: 0, no: 0, notSet: 0 } : null,
    };
    const approvedCounts = {
      BREAKFAST: 0,
      LUNCH: 0,
      DINNER: 0,
    };
    for (const request of approvedRequests) {
      approvedCounts[request.mealType] += 1;
    }
    const deptBreakdown: Record<string, any> = {};

    for (const user of users) {
      const dept = user.dept || "Unassigned";
      if (!deptBreakdown[dept]) {
        deptBreakdown[dept] = {
          BREAKFAST: served.BREAKFAST ? { yes: 0, no: 0, notSet: 0 } : null,
          LUNCH: served.LUNCH ? { yes: 0, no: 0, notSet: 0 } : null,
          DINNER: served.DINNER ? { yes: 0, no: 0, notSet: 0 } : null,
        };
      }
      for (const mealType of [MealType.BREAKFAST, MealType.LUNCH, MealType.DINNER]) {
        if (!served[mealType]) continue;
        const explicit = choiceMap.get(`${user.id}|${mealType}`);
        if (explicit) {
          if (explicit.wantMeal) {
            counts[mealType].yes += 1;
            deptBreakdown[dept][mealType].yes += 1;
          } else {
            counts[mealType].no += 1;
            deptBreakdown[dept][mealType].no += 1;
          }
          continue;
        }
        const prefList = prefsByUserMeal.get(`${user.id}|${mealType}`) || [];
        const pref = findPreference(prefList, dateStr);
        if (pref) {
          if (pref.defaultWantMeal) {
            counts[mealType].yes += 1;
            deptBreakdown[dept][mealType].yes += 1;
          } else {
            counts[mealType].no += 1;
            deptBreakdown[dept][mealType].no += 1;
          }
        } else {
          counts[mealType].notSet += 1;
          deptBreakdown[dept][mealType].notSet += 1;
        }
      }
    }

    const checkins = {
      BREAKFAST: served.BREAKFAST
        ? await prisma.mealCheckin.count({ where: { date: dateStr, mealType: MealType.BREAKFAST } })
        : null,
      LUNCH: served.LUNCH
        ? await prisma.mealCheckin.count({ where: { date: dateStr, mealType: MealType.LUNCH } })
        : null,
      DINNER: served.DINNER
        ? await prisma.mealCheckin.count({ where: { date: dateStr, mealType: MealType.DINNER } })
        : null,
    };
    const waste = {
      BREAKFAST:
        served.BREAKFAST && counts.BREAKFAST
          ? Math.max(0, counts.BREAKFAST.yes - (checkins.BREAKFAST || 0))
          : null,
      LUNCH:
        served.LUNCH && counts.LUNCH
          ? Math.max(0, counts.LUNCH.yes - (checkins.LUNCH || 0))
          : null,
      DINNER:
        served.DINNER && counts.DINNER
          ? Math.max(0, counts.DINNER.yes - (checkins.DINNER || 0))
          : null,
    };

    return res.json({
      date: dateStr,
      served,
      counts,
      approvedRequests: approvedCounts,
      checkins,
      waste,
      deptBreakdown,
    });
  }
);

router.get(
  "/reports/daily/details",
  authMiddleware,
  requireRole([Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (req, res) => {
    const schema = z.object({
      date: dateOnlySchema,
      view: z.enum(["combined", "meal"]).default("combined"),
      mealType: z.nativeEnum(MealType).optional(),
    });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid query" });
    }

    const { date: dateValue, view, mealType } = parsed.data;
    if (view === "meal" && !mealType) {
      return res.status(400).json({ error: "mealType required for meal view" });
    }

    const dateValueObj = normalizeDateOnly(dateValue);
    const serviceDay = await getEffectiveServiceDay(dateValue);
    const officeOpen = serviceDay.isOfficeOpen !== false;
    const served = {
      BREAKFAST: isMealServed(serviceDay, MealType.BREAKFAST),
      LUNCH: isMealServed(serviceDay, MealType.LUNCH),
      DINNER: isMealServed(serviceDay, MealType.DINNER),
    };

    const users = await prisma.user.findMany({
      where: { active: true },
      select: { id: true, employeeId: true, name: true, dept: true },
      orderBy: { employeeId: "asc" },
    });

    const [choices, preferences, requests, checkins] = await Promise.all([
      prisma.mealChoice.findMany({
        where: { date: dateValueObj },
      }),
      prisma.mealPreference.findMany({
        where: { userId: { in: users.map((user) => user.id) }, active: true },
        orderBy: { updatedAt: "desc" },
      }),
      prisma.mealRequest.findMany({
        where: { date: dateValue },
      }),
      prisma.mealCheckin.findMany({
        where: { date: dateValue },
      }),
    ]);

    const choiceMap = new Map(
      choices.map((choice) => [`${choice.userId}:${choice.mealType}`, choice])
    );
    const requestMap = new Map(
      requests.map((request) => [`${request.userId}:${request.mealType}`, request])
    );
    const checkinMap = new Map(
      checkins.map((checkin) => [`${checkin.userId}:${checkin.mealType}`, checkin])
    );
    const prefMap = new Map<string, any>();
    for (const pref of preferences) {
      const key = `${pref.userId}:${pref.mealType}`;
      if (!prefMap.has(key) && preferenceApplies(pref, dateValue)) {
        prefMap.set(key, pref);
      }
    }

    const mealsToInclude =
      view === "meal" && mealType
        ? [mealType]
        : [MealType.BREAKFAST, MealType.LUNCH, MealType.DINNER];

    const rows = users.map((user) => {
      const row: any = {
        employeeId: user.employeeId,
        name: user.name,
        department: user.dept || "Unassigned",
      };
      for (const meal of mealsToInclude) {
        const availability = officeOpen && served[meal];
        const key = `${user.id}:${meal}`;
        const request = requestMap.get(key);
        if (!availability) {
          row[meal.toLowerCase()] = {
            final: "NA",
            source: "NA",
            requestStatus: request?.status ?? null,
          };
          continue;
        }
        const explicit = choiceMap.get(key);
        if (explicit) {
          row[meal.toLowerCase()] = {
            final: explicit.wantMeal ? "YES" : "NO",
            source: "EXPLICIT",
            requestStatus: request?.status ?? null,
          };
          continue;
        }
        const pref = prefMap.get(key);
        if (pref) {
          row[meal.toLowerCase()] = {
            final: pref.defaultWantMeal ? "YES" : "NO",
            source: "DEFAULT",
            requestStatus: request?.status ?? null,
          };
        } else {
          row[meal.toLowerCase()] = {
            final: "NOT_SET",
            source: "NOT_SET",
            requestStatus: request?.status ?? null,
          };
        }
      }
      return row;
    });

    return res.json({
      date: dateValue,
      officeOpen,
      serviceDay: {
        breakfastServed: served.BREAKFAST,
        lunchServed: served.LUNCH,
        dinnerServed: served.DINNER,
      },
      rows,
    });
  }
);

export default router;
export { normalizeDateOnly };
