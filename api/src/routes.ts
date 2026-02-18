import express from "express";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { MealRequestStatus, MealType, PrismaClient, Role, Source } from "@prisma/client";
import { authMiddleware, requireRole, signToken } from "./auth.js";
import { addDaysToDateString, getZonedDateString, zonedTimeToUtc } from "./timezone.js";

type MealRequestStatusType = (typeof MealRequestStatus)[keyof typeof MealRequestStatus];
type MealTypeType = (typeof MealType)[keyof typeof MealType];
type RoleType = (typeof Role)[keyof typeof Role];
type SourceType = (typeof Source)[keyof typeof Source];

const prisma = new PrismaClient();
const router = express.Router();

function firstString(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    const [first] = value;
    return typeof first === "string" ? first : undefined;
  }
  return undefined;
}

function mustString(value: unknown, name: string): string {
  const resolved = firstString(value);
  if (!resolved) {
    const error = new Error(`Missing ${name}`);
    (error as Error & { statusCode?: number }).statusCode = 400;
    throw error;
  }
  return resolved;
}

function mealTypeKey(mealType: MealTypeType): "breakfast" | "lunch" | "dinner" {
  if (mealType === MealType.BREAKFAST) return "breakfast";
  if (mealType === MealType.LUNCH) return "lunch";
  return "dinner";
}

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
const MASTER_CACHE_TTL_MS = 60_000;
let masterDataCache: { ts: number; data: { departments: string[]; sites: string[] } } | null = null;
const MASTER_MAX_ITEMS = 200;
const MASTER_MAX_LENGTH = 60;
const UNASSIGNED_LABEL = "Unassigned";
const DEFAULT_AUTH_MODE = "pin";
const AUTH_MODE_VALUES = new Set(["pin", "both", "password"]);
const DEFAULT_INVITE_ALLOWED_DOMAIN = "akshayakalpa.org";
const DEFAULT_INVITE_TTL_HOURS = 72;
const DEFAULT_INVITE_BASE_URL = "https://cafeteria.akshayakalpa.org";
const LOGIN_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_RATE_LIMIT_MAX = 10;
const REGISTER_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const REGISTER_RATE_LIMIT_MAX = 8;
type AuthMode = "pin" | "both" | "password";
type AuthRateBucket = { count: number; resetAt: number };
const authRateBuckets = new Map<string, AuthRateBucket>();

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function getAuthMode(): AuthMode {
  const raw = String(process.env.AUTH_MODE || DEFAULT_AUTH_MODE).trim().toLowerCase();
  if (AUTH_MODE_VALUES.has(raw)) return raw as AuthMode;
  return DEFAULT_AUTH_MODE as AuthMode;
}

function getInviteAllowedDomain(): string {
  const raw = String(process.env.INVITE_ALLOWED_DOMAIN || DEFAULT_INVITE_ALLOWED_DOMAIN)
    .trim()
    .toLowerCase();
  return raw.replace(/^@+/, "");
}

function isAllowedInviteEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  const domain = getInviteAllowedDomain();
  return normalized.endsWith(`@${domain}`);
}

function getInviteTtlHours(): number {
  const raw = Number(process.env.INVITE_TTL_HOURS || DEFAULT_INVITE_TTL_HOURS);
  if (!Number.isFinite(raw)) return DEFAULT_INVITE_TTL_HOURS;
  return Math.max(1, Math.min(24 * 14, Math.floor(raw)));
}

function hashInviteToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

function generateInviteToken(): string {
  return randomBytes(32).toString("hex");
}

function generateRandomSecret(): string {
  return randomBytes(48).toString("hex");
}

function buildInviteLink(token: string): string {
  const base = String(process.env.INVITE_BASE_URL || DEFAULT_INVITE_BASE_URL).replace(/\/+$/, "");
  return `${base}/invite/${token}`;
}

function getRequestIp(req: express.Request): string {
  const forwarded = firstString(req.headers["x-forwarded-for"]);
  if (forwarded) {
    const [first] = forwarded.split(",");
    if (first?.trim()) return first.trim();
  }
  return req.ip || "unknown";
}

function cleanupRateBuckets() {
  if (authRateBuckets.size < 5000) return;
  const now = Date.now();
  for (const [key, value] of authRateBuckets.entries()) {
    if (value.resetAt <= now) {
      authRateBuckets.delete(key);
    }
  }
}

function consumeRateLimit(
  key: string,
  max: number,
  windowMs: number
): { limited: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const existing = authRateBuckets.get(key);
  if (!existing || existing.resetAt <= now) {
    authRateBuckets.set(key, { count: 1, resetAt: now + windowMs });
    cleanupRateBuckets();
    return { limited: false, retryAfterSeconds: 0 };
  }
  existing.count += 1;
  authRateBuckets.set(key, existing);
  cleanupRateBuckets();
  if (existing.count > max) {
    return {
      limited: true,
      retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
    };
  }
  return { limited: false, retryAfterSeconds: 0 };
}

function checkAuthRateLimit(
  req: express.Request,
  res: express.Response,
  scope: "login" | "register",
  identifier: string
) {
  const ip = getRequestIp(req);
  const keySuffix = identifier.trim().toLowerCase() || "unknown";
  const max = scope === "login" ? LOGIN_RATE_LIMIT_MAX : REGISTER_RATE_LIMIT_MAX;
  const windowMs =
    scope === "login" ? LOGIN_RATE_LIMIT_WINDOW_MS : REGISTER_RATE_LIMIT_WINDOW_MS;
  const attempts = [
    consumeRateLimit(`${scope}:ip:${ip}`, max, windowMs),
    consumeRateLimit(`${scope}:id:${keySuffix}`, max, windowMs),
  ];
  const limited = attempts.find((attempt) => attempt.limited);
  if (limited) {
    res.setHeader("Retry-After", String(limited.retryAfterSeconds));
    res.status(429).json({
      error: "TOO_MANY_ATTEMPTS",
      retryAfterSeconds: limited.retryAfterSeconds,
    });
    return true;
  }
  return false;
}

function validatePasswordPolicy(password: string): string | null {
  if (password.length < 8) return "PASSWORD_TOO_SHORT";
  if (!/[A-Z]/.test(password)) return "PASSWORD_NEEDS_UPPERCASE";
  if (!/[a-z]/.test(password)) return "PASSWORD_NEEDS_LOWERCASE";
  if (!/[0-9]/.test(password)) return "PASSWORD_NEEDS_NUMBER";
  if (!/[^A-Za-z0-9]/.test(password)) return "PASSWORD_NEEDS_SPECIAL_CHAR";
  return null;
}

function toAuthResponse(user: {
  id: string;
  employeeId: string;
  name: string;
  dept: string | null;
  site: string | null;
  role: Role;
}) {
  const token = signToken({
    id: user.id,
    employeeId: user.employeeId,
    name: user.name,
    dept: user.dept,
    site: user.site ?? null,
    role: user.role,
  });

  return {
    token,
    user: {
      employeeId: user.employeeId,
      name: user.name,
      role: user.role,
      dept: user.dept,
      site: user.site ?? null,
    },
  };
}

function getInviteStatus(invite: { usedAt: Date | null; expiresAt: Date }, now: Date) {
  if (invite.usedAt) return "USED";
  if (invite.expiresAt <= now) return "EXPIRED";
  return "ACTIVE";
}

function getDefaultSettings() {
  return {
    timezone: "Asia/Kolkata",
    cutoffs: {
      BREAKFAST: "09:00",
      LUNCH: "11:00",
      DINNER: "17:00",
    },
    cutoffDayOffsets: {
      BREAKFAST: 0,
      LUNCH: 0,
      DINNER: 0,
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
          "cutoffDayOffset.breakfast",
          "cutoffDayOffset.lunch",
          "cutoffDayOffset.dinner",
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
  const resolveOffset = (value: string | undefined, fallback: number) => {
    const parsed = Number(value);
    if (parsed === -1 || parsed === 0) return parsed;
    return fallback;
  };
  const data = {
    timezone: map.get("timezone") || defaults.timezone,
    cutoffs: {
      BREAKFAST: map.get("cutoff.breakfast") || defaults.cutoffs.BREAKFAST,
      LUNCH: map.get("cutoff.lunch") || defaults.cutoffs.LUNCH,
      DINNER: map.get("cutoff.dinner") || defaults.cutoffs.DINNER,
    },
    cutoffDayOffsets: {
      BREAKFAST: resolveOffset(map.get("cutoffDayOffset.breakfast"), defaults.cutoffDayOffsets.BREAKFAST),
      LUNCH: resolveOffset(map.get("cutoffDayOffset.lunch"), defaults.cutoffDayOffsets.LUNCH),
      DINNER: resolveOffset(map.get("cutoffDayOffset.dinner"), defaults.cutoffDayOffsets.DINNER),
    },
    weeklyTemplate,
    jwtExpiryMinutes: map.get("jwtExpiryMinutes") || defaults.jwtExpiryMinutes,
    pinPolicyMinLength: map.get("pinPolicyMinLength") || defaults.pinPolicyMinLength,
  };
  settingsCache = { ts: Date.now(), data };
  return data;
}

function sortMasterValues(values: string[]): string[] {
  const lowerUnassigned = UNASSIGNED_LABEL.toLowerCase();
  return [...values].sort((a, b) => {
    const aLower = a.toLowerCase();
    const bLower = b.toLowerCase();
    if (aLower === lowerUnassigned) return -1;
    if (bLower === lowerUnassigned) return 1;
    return a.localeCompare(b);
  });
}

function normalizeMasterList(
  raw: unknown,
  strict: boolean
): { values: string[]; error?: string } {
  if (!Array.isArray(raw)) {
    return { values: [], error: "MASTER_DATA_LIST_INVALID" };
  }
  const seen = new Set<string>();
  const values: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      if (strict) return { values: [], error: "MASTER_DATA_ITEM_INVALID" };
      continue;
    }
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (trimmed.length > MASTER_MAX_LENGTH) {
      if (strict) return { values: [], error: "MASTER_DATA_ITEM_TOO_LONG" };
      continue;
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    values.push(trimmed);
  }

  if (!seen.has(UNASSIGNED_LABEL.toLowerCase())) {
    values.push(UNASSIGNED_LABEL);
  }

  if (values.length > MASTER_MAX_ITEMS) {
    if (strict) return { values: [], error: "MASTER_DATA_TOO_MANY_ITEMS" };
    return { values: sortMasterValues(values.slice(0, MASTER_MAX_ITEMS)) };
  }

  return { values: sortMasterValues(values) };
}

function parseMasterSettingValue(value: string | null | undefined) {
  if (!value) return [];
  try {
    return JSON.parse(value);
  } catch {
    return [];
  }
}

function hasUnassigned(raw: unknown): boolean {
  if (!Array.isArray(raw)) return false;
  return raw.some(
    (item) =>
      typeof item === "string" &&
      item.trim().toLowerCase() === UNASSIGNED_LABEL.toLowerCase()
  );
}

function isUnassignedValue(value: string | null | undefined): boolean {
  if (!value) return true;
  return value.trim().toLowerCase() === UNASSIGNED_LABEL.toLowerCase();
}

async function getMasterDataSnapshot() {
  if (masterDataCache && Date.now() - masterDataCache.ts < MASTER_CACHE_TTL_MS) {
    return masterDataCache.data;
  }
  const records = await prisma.appSetting.findMany({
    where: {
      key: {
        in: ["master.departments", "master.sites"],
      },
    },
  });
  const map = new Map(records.map((record) => [record.key, record.value]));
  const departmentsNormalized = normalizeMasterList(
    parseMasterSettingValue(map.get("master.departments")),
    false
  );
  const sitesNormalized = normalizeMasterList(
    parseMasterSettingValue(map.get("master.sites")),
    false
  );
  const data = {
    departments: departmentsNormalized.values,
    sites: sitesNormalized.values,
  };
  masterDataCache = { ts: Date.now(), data };
  return data;
}

function resolveMasterValue(value: string | null | undefined, allowed: string[]) {
  if (value === null || value === undefined) return { value: null };
  const trimmed = value.trim();
  if (!trimmed) return { value: null };
  const match = allowed.find((item) => item.toLowerCase() === trimmed.toLowerCase());
  if (!match) return { value: null, error: "INVALID" };
  return { value: match };
}

async function getMasterDataUsageRaw() {
  const [deptGroups, siteGroups] = await Promise.all([
    prisma.user.groupBy({
      by: ["dept"],
      _count: { _all: true },
    }),
    prisma.user.groupBy({
      by: ["site"],
      _count: { _all: true },
    }),
  ]);

  const departments: Record<string, number> = {};
  const sites: Record<string, number> = {};

  for (const group of deptGroups) {
    const key = group.dept ?? UNASSIGNED_LABEL;
    departments[key] = (departments[key] ?? 0) + (group._count?._all ?? 0);
  }

  for (const group of siteGroups) {
    const key = group.site ?? UNASSIGNED_LABEL;
    sites[key] = (sites[key] ?? 0) + (group._count?._all ?? 0);
  }

  return { departments, sites };
}

function normalizeUsageToMaster(usage: Record<string, number>, masterList: string[]) {
  const normalized: Record<string, number> = {};
  for (const [key, count] of Object.entries(usage)) {
    const match = masterList.find((item) => item.toLowerCase() === key.toLowerCase());
    const resolvedKey = match || key;
    normalized[resolvedKey] = (normalized[resolvedKey] ?? 0) + count;
  }
  for (const item of masterList) {
    if (normalized[item] === undefined) normalized[item] = 0;
  }
  return normalized;
}

async function getMasterDataUsage(masterData: { departments: string[]; sites: string[] }) {
  const raw = await getMasterDataUsageRaw();
  return {
    departments: normalizeUsageToMaster(raw.departments, masterData.departments),
    sites: normalizeUsageToMaster(raw.sites, masterData.sites),
  };
}

function parseTimeString(value: string | null | undefined) {
  if (!value) return null;
  const [hourStr, minuteStr] = value.split(":");
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
  return { hour, minute };
}

function getCutoffDayOffset(mealType: MealTypeType, settings?: any): number {
  const fallback = getDefaultSettings().cutoffDayOffsets[mealType] ?? 0;
  const raw = settings?.cutoffDayOffsets?.[mealType];
  return raw === -1 || raw === 0 ? raw : fallback;
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
}, mealType: MealTypeType) {
  if (!serviceDay.isOfficeOpen) return false;
  if (mealType === MealType.BREAKFAST) return serviceDay.breakfastServed;
  if (mealType === MealType.LUNCH) return serviceDay.lunchServed;
  return serviceDay.dinnerServed;
}

// Cutoff enforcement helpers (timezone-aware). Remove together if reverting this feature.
function getCutoffDate(dateStr: string, mealType: MealTypeType, serviceDay?: any, settings?: any): Date {
  const cutoffOverride =
    mealType === MealType.BREAKFAST
      ? parseTimeString(serviceDay?.breakfastCutoff)
      : mealType === MealType.LUNCH
        ? parseTimeString(serviceDay?.lunchCutoff)
        : parseTimeString(serviceDay?.dinnerCutoff);
  const baseCutoffLabel = settings?.cutoffs?.[mealType] || cutoffTimes[mealType].label;
  const baseCutoff = parseTimeString(baseCutoffLabel) ?? cutoffTimes[mealType];
  const cutoff = cutoffOverride ?? baseCutoff;
  const cutoffLabel = `${String(cutoff.hour).padStart(2, "0")}:${String(cutoff.minute).padStart(2, "0")}`;
  const timezone = settings?.timezone || getDefaultSettings().timezone;
  const cutoffDayOffset = getCutoffDayOffset(mealType, settings);
  const cutoffDateStr = addDaysToDateString(dateStr, cutoffDayOffset);
  return zonedTimeToUtc(cutoffDateStr, cutoffLabel, timezone);
}

function isPastServiceDate(dateStr: string, settings?: any): boolean {
  const timezone = settings?.timezone || getDefaultSettings().timezone;
  const today = getZonedDateString(timezone);
  return dateStr < today;
}

function sendCutoffPassed(
  res: express.Response,
  params: { mealType: MealTypeType; cutoffLabel: string; timezone: string; cutoffDayOffset: number }
) {
  return res.status(409).json({
    error: "CUTOFF_PASSED",
    meal: params.mealType,
    cutoff: params.cutoffLabel,
    timezone: params.timezone,
    cutoffDayOffset: params.cutoffDayOffset,
  });
}

function sendPastDate(res: express.Response, params: { date: string; timezone: string }) {
  return res.status(409).json({
    error: "PAST_DATE",
    date: params.date,
    timezone: params.timezone,
  });
}

function sendMealNotServed(res: express.Response, params: { date: string; mealType: MealTypeType }) {
  return res.status(409).json({
    error: "MEAL_NOT_SERVED",
    date: params.date,
    meal: params.mealType,
  });
}

function getCutoffTimeLabel(mealType: MealTypeType, serviceDay?: any, settings?: any): string {
  const override =
    mealType === MealType.BREAKFAST
      ? serviceDay?.breakfastCutoff
      : mealType === MealType.LUNCH
        ? serviceDay?.lunchCutoff
        : serviceDay?.dinnerCutoff;
  const baseLabel = settings?.cutoffs?.[mealType] || cutoffTimes[mealType].label;
  return override || baseLabel;
}

function getCutoffLabel(mealType: MealTypeType, serviceDay?: any, settings?: any): string {
  const label = getCutoffTimeLabel(mealType, serviceDay, settings);
  const cutoffDayOffset = getCutoffDayOffset(mealType, settings);
  if (cutoffDayOffset === -1) return `${label} (previous day)`;
  return label;
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

const SENSITIVE_AUDIT_KEYS = new Set([
  "pinhash",
  "passwordhash",
  "password",
  "tokenhash",
  "token",
  "secret",
  "authorization",
]);

function redactSensitive(value: any): any {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item));
  if (typeof value !== "object") return value;
  const output: Record<string, any> = {};
  for (const [key, val] of Object.entries(value)) {
    if (SENSITIVE_AUDIT_KEYS.has(key.toLowerCase())) continue;
    output[key] = redactSensitive(val);
  }
  return output;
}

function sanitizeAuditJson(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return JSON.stringify(redactSensitive(parsed));
  } catch {
    return value;
  }
}

function prepareAuditValue(value: any): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    return sanitizeAuditJson(value);
  }
  return JSON.stringify(redactSensitive(value));
}

async function isSupervisorScopeAllowed(reqUser: { id: string; role: RoleType; employeeId: string; site: string | null }, targetUser: { id: string; site: string | null }) {
  if (reqUser.role !== Role.SUPERVISOR) return true;
  if (!reqUser.site || isUnassignedValue(reqUser.site)) return false;
  if (!targetUser.site || isUnassignedValue(targetUser.site)) return false;
  if (reqUser.site !== targetUser.site) return false;
  const assignment = await prisma.supervisorAssignment.findUnique({
    where: { employeeId: targetUser.id },
    select: { supervisorId: true },
  });
  return assignment?.supervisorId === reqUser.id;
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
      before: prepareAuditValue(params.before),
      after: prepareAuditValue(params.after),
    },
  });
}

async function getEffectiveChoicesForUser(userId: string, from: string, to: string) {
  const settings = await getSettingsSnapshot();
  const now = new Date();
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
  const prefsByMeal = new Map<MealTypeType, any[]>();
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
      const cutoffDate = getCutoffDate(dateStr, mealType, serviceDay, settings);
      const cutoffPassed = servedGlobal ? now > cutoffDate : false;
      const updatedByRole = explicit?.updatedById ? updatedByMap.get(explicit.updatedById) : null;
      const overridden =
        !!explicit &&
        (updatedByRole === Role.HR_ADMIN || updatedByRole === Role.SUPER_ADMIN) &&
        explicit.updatedAt > cutoffDate;
      if (!servedGlobal || !officeOpen) {
        result.push({
          date: dateStr,
          mealType,
          status: "NA",
          choiceStatus: "NA",
          wantMeal: request?.status === "APPROVED" ? true : null,
          preferenceHintWantMeal: null,
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
          preferenceHintWantMeal: null,
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
      result.push({
        date: dateStr,
        mealType,
        status: "NOT_SET",
        choiceStatus: "NOT_SET",
        wantMeal: null,
        preferenceHintWantMeal: pref ? pref.defaultWantMeal : null,
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

  return result;
}

router.post("/auth/login", async (req, res) => {
  const employeeId = typeof req.body?.employeeId === "string" ? req.body.employeeId.trim() : "";
  const pin = typeof req.body?.pin === "string" ? req.body.pin.trim() : "";
  const identifier = typeof req.body?.identifier === "string" ? req.body.identifier.trim() : "";
  const password = typeof req.body?.password === "string" ? req.body.password : "";
  const authMode = getAuthMode();

  if (employeeId && pin) {
    if (authMode === "password") {
      return res.status(403).json({ error: "PIN_LOGIN_DISABLED" });
    }
    if (checkAuthRateLimit(req, res, "login", employeeId)) return;
    const user = await prisma.user.findFirst({
      where: { employeeId, active: true },
      select: {
        id: true,
        employeeId: true,
        name: true,
        dept: true,
        site: true,
        role: true,
        pinHash: true,
      },
    });

    if (!user) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const match = await bcrypt.compare(pin, user.pinHash);
    if (!match) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    return res.json(toAuthResponse(user));
  }

  if (identifier && password) {
    if (authMode === "pin") {
      return res.status(403).json({ error: "PASSWORD_LOGIN_DISABLED" });
    }
    const normalizedIdentifier = identifier.toLowerCase();
    if (checkAuthRateLimit(req, res, "login", normalizedIdentifier)) return;
    const isEmail = identifier.includes("@");
    if (isEmail && !isAllowedInviteEmail(identifier)) {
      return res.status(403).json({ error: "EMAIL_DOMAIN_NOT_ALLOWED" });
    }

    const user = await prisma.user.findFirst({
      where: isEmail
        ? { email: normalizeEmail(identifier), active: true }
        : { employeeId: identifier, active: true },
      select: {
        id: true,
        employeeId: true,
        name: true,
        dept: true,
        site: true,
        role: true,
        email: true,
        passwordHash: true,
      },
    });
    if (!user || !user.passwordHash || !user.email || !isAllowedInviteEmail(user.email)) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    return res.json(toAuthResponse(user));
  }

  return res.status(400).json({
    error: "Invalid payload",
    expected: [
      "{ employeeId, pin }",
      "{ identifier, password }",
    ],
  });
});

router.get("/auth/invite/:token", async (req, res) => {
  let token: string;
  try {
    token = mustString(req.params.token, "token").trim();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return res.status(400).json({ error: message });
  }
  if (!token) {
    return res.status(400).json({ error: "Invalid token" });
  }

  const invite = await prisma.userInvite.findFirst({
    where: { tokenHash: hashInviteToken(token) },
    select: {
      id: true,
      email: true,
      role: true,
      dept: true,
      site: true,
      supervisorEmployeeId: true,
      expiresAt: true,
      usedAt: true,
      createdAt: true,
    },
  });

  if (!invite) {
    return res.status(404).json({ error: "INVITE_NOT_FOUND" });
  }
  if (invite.usedAt) {
    return res.status(410).json({ error: "INVITE_ALREADY_USED" });
  }
  if (invite.expiresAt <= new Date()) {
    return res.status(410).json({ error: "INVITE_EXPIRED" });
  }

  return res.json({
    id: invite.id,
    email: invite.email,
    role: invite.role,
    dept: invite.dept,
    site: invite.site,
    supervisorEmployeeId: invite.supervisorEmployeeId,
    expiresAt: invite.expiresAt,
    createdAt: invite.createdAt,
  });
});

router.post("/auth/register", async (req, res) => {
  const schema = z.object({
    token: z.string().trim().min(1),
    employeeId: z.string().trim().min(1),
    name: z.string().trim().min(1),
    password: z.string().min(1),
    phone: z.string().trim().optional(),
    dept: z.string().trim().optional(),
    site: z.string().trim().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid payload" });
  }
  if (checkAuthRateLimit(req, res, "register", parsed.data.employeeId)) return;

  const { token, employeeId, name, password, phone, dept, site } = parsed.data;
  const passwordPolicyError = validatePasswordPolicy(password);
  if (passwordPolicyError) {
    return res.status(400).json({ error: passwordPolicyError });
  }

  const tokenHash = hashInviteToken(token);
  const invite = await prisma.userInvite.findFirst({
    where: { tokenHash },
    select: {
      id: true,
      email: true,
      role: true,
      dept: true,
      site: true,
      supervisorEmployeeId: true,
      expiresAt: true,
      usedAt: true,
    },
  });

  if (!invite) {
    return res.status(404).json({ error: "INVITE_NOT_FOUND" });
  }
  if (invite.usedAt) {
    return res.status(410).json({ error: "INVITE_ALREADY_USED" });
  }
  if (invite.expiresAt <= new Date()) {
    return res.status(410).json({ error: "INVITE_EXPIRED" });
  }
  if (!isAllowedInviteEmail(invite.email)) {
    return res.status(400).json({ error: "EMAIL_DOMAIN_NOT_ALLOWED" });
  }

  const masterData = await getMasterDataSnapshot();
  const deptInput = invite.dept ?? dept;
  const siteInput = invite.site ?? site;
  const deptResolved = resolveMasterValue(deptInput, masterData.departments);
  if (deptResolved.error) {
    return res.status(400).json({ error: "INVALID_DEPT", allowed: masterData.departments });
  }
  const siteResolved = resolveMasterValue(siteInput, masterData.sites);
  if (siteResolved.error) {
    return res.status(400).json({ error: "INVALID_SITE", allowed: masterData.sites });
  }

  const supervisorEmployeeId = invite.supervisorEmployeeId?.trim() || null;
  if (invite.role === Role.GROUND_STAFF) {
    if (isUnassignedValue(siteResolved.value)) {
      return res.status(400).json({ error: "SITE_REQUIRED_FOR_GROUND_STAFF" });
    }
    if (!supervisorEmployeeId) {
      return res.status(400).json({ error: "SUPERVISOR_REQUIRED_FOR_GROUND_STAFF" });
    }
  }

  const [existingEmployeeId, existingEmail] = await Promise.all([
    prisma.user.findUnique({ where: { employeeId }, select: { id: true } }),
    prisma.user.findFirst({
      where: { email: normalizeEmail(invite.email) },
      select: { id: true },
    }),
  ]);
  if (existingEmployeeId) {
    return res.status(409).json({ error: "EMPLOYEE_ID_ALREADY_EXISTS" });
  }
  if (existingEmail) {
    return res.status(409).json({ error: "EMAIL_ALREADY_EXISTS" });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const pinHash = await bcrypt.hash(generateRandomSecret(), 10);
  const now = new Date();
  const normalizedInviteEmail = normalizeEmail(invite.email);
  try {
    const createdUser = await prisma.$transaction(async (tx) => {
      let supervisor: { id: string; employeeId: string; site: string | null } | null = null;
      if (supervisorEmployeeId) {
        supervisor = await tx.user.findFirst({
          where: {
            employeeId: supervisorEmployeeId,
            role: Role.SUPERVISOR,
            active: true,
          },
          select: { id: true, employeeId: true, site: true },
        });
        if (!supervisor) {
          throw new Error("SUPERVISOR_NOT_FOUND");
        }
      }

      if (invite.role === Role.GROUND_STAFF) {
        if (!supervisor || isUnassignedValue(supervisor.site) || supervisor.site !== siteResolved.value) {
          throw new Error("SUPERVISOR_SITE_MISMATCH");
        }
      }

      const user = await tx.user.create({
        data: {
          employeeId,
          name,
          email: normalizedInviteEmail,
          phone: phone?.trim() || null,
          dept: deptResolved.value,
          site: siteResolved.value,
          role: invite.role,
          pinHash,
          passwordHash,
          authProvider: "PASSWORD",
          active: true,
        },
        select: {
          id: true,
          employeeId: true,
          name: true,
          dept: true,
          site: true,
          role: true,
        },
      });

      if (invite.role === Role.GROUND_STAFF && supervisor) {
        await tx.supervisorAssignment.upsert({
          where: { employeeId: user.id },
          create: {
            employeeId: user.id,
            supervisorId: supervisor.id,
          },
          update: {
            supervisorId: supervisor.id,
          },
        });
      }

      const consume = await tx.userInvite.updateMany({
        where: {
          id: invite.id,
          tokenHash,
          usedAt: null,
          expiresAt: { gt: now },
        },
        data: { usedAt: now },
      });

      if (consume.count !== 1) {
        throw new Error("INVITE_ALREADY_USED");
      }

      return user;
    });

    await logAudit({
      actorId: createdUser.id,
      action: "REGISTER_USER",
      entity: "User",
      entityId: createdUser.id,
      after: {
        employeeId: createdUser.employeeId,
        role: createdUser.role,
        dept: createdUser.dept,
        site: createdUser.site,
      },
    });

    return res.json(toAuthResponse(createdUser));
  } catch (error) {
    const message = error instanceof Error ? error.message : "REGISTER_FAILED";
    if (message === "SUPERVISOR_NOT_FOUND") {
      return res.status(404).json({ error: "Supervisor not found" });
    }
    if (message === "SUPERVISOR_SITE_MISMATCH") {
      return res.status(400).json({ error: "SUPERVISOR_SITE_MISMATCH" });
    }
    if (message === "INVITE_ALREADY_USED") {
      return res.status(410).json({ error: "INVITE_ALREADY_USED" });
    }
    throw error;
  }
});

router.get("/system/time", authMiddleware, async (_req, res) => {
  const settings = await getSettingsSnapshot();
  return res.json({
    serverNow: new Date().toISOString(),
    timezone: settings?.timezone || getDefaultSettings().timezone,
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
  const timezone = settings?.timezone || getDefaultSettings().timezone;
  const cutoffDayOffset = getCutoffDayOffset(mealType, settings);
  if (isPastServiceDate(date, settings)) {
    return sendPastDate(res, { date, timezone });
  }
  const serviceDay = await getEffectiveServiceDay(date);
  if (!isMealServed(serviceDay, mealType)) {
    return sendMealNotServed(res, { date, mealType });
  }
  const cutoffDate = getCutoffDate(date, mealType, serviceDay, settings);
  if (new Date() > cutoffDate) {
    return sendCutoffPassed(res, {
      mealType,
      cutoffLabel: getCutoffTimeLabel(mealType, serviceDay, settings),
      timezone,
      cutoffDayOffset,
    });
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
  const timezone = settings?.timezone || getDefaultSettings().timezone;
  const cutoffDayOffset = getCutoffDayOffset(mealType, settings);
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
    return sendCutoffPassed(res, {
      mealType,
      cutoffLabel: getCutoffTimeLabel(mealType, serviceDay, settings),
      timezone,
      cutoffDayOffset,
    });
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
  const timezone = settings?.timezone || getDefaultSettings().timezone;
  const cutoffDayOffset = getCutoffDayOffset(mealType, settings);
  if (isPastServiceDate(date, settings)) {
    return sendPastDate(res, { date, timezone });
  }
  const serviceDay = await getEffectiveServiceDay(date);
  if (!isMealServed(serviceDay, mealType)) {
    return sendMealNotServed(res, { date, mealType });
  }
  const cutoffDate = getCutoffDate(date, mealType, serviceDay, settings);
  const isAfterCutoff = new Date() > cutoffDate;
  const isHrOverride = req.user.role === Role.HR_ADMIN || req.user.role === Role.SUPER_ADMIN;
  if (isAfterCutoff && !isHrOverride) {
    return sendCutoffPassed(res, {
      mealType,
      cutoffLabel: getCutoffTimeLabel(mealType, serviceDay, settings),
      timezone,
      cutoffDayOffset,
    });
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
    const timezone = settings?.timezone || getDefaultSettings().timezone;
    const cutoffDayOffset = getCutoffDayOffset(mealType, settings);
    if (isPastServiceDate(date, settings)) {
      return sendPastDate(res, { date, timezone });
    }
    const serviceDay = await getEffectiveServiceDay(date);
    if (!isMealServed(serviceDay, mealType)) {
      return sendMealNotServed(res, { date, mealType });
    }
    const cutoffDate = getCutoffDate(date, mealType, serviceDay, settings);
    const now = new Date();
    const isAfterCutoff = now > cutoffDate;
    const isHrOverride = req.user.role === Role.HR_ADMIN || req.user.role === Role.SUPER_ADMIN;
    if (isAfterCutoff && !isHrOverride) {
      return sendCutoffPassed(res, {
        mealType,
        cutoffLabel: getCutoffTimeLabel(mealType, serviceDay, settings),
        timezone,
        cutoffDayOffset,
      });
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
    if (!(await isSupervisorScopeAllowed(req.user, targetUser))) {
      return res.status(403).json({ error: "NOT_YOUR_USER" });
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

router.post(
  "/supervisor/ground-staff/bulk",
  authMiddleware,
  requireRole([Role.SUPERVISOR, Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (req, res) => {
    const schema = z.object({
      from: dateOnlySchema,
      to: dateOnlySchema,
      meals: z.array(z.nativeEnum(MealType)).min(1),
      wantMeal: z.boolean(),
      overrideReason: z.string().trim().optional(),
      site: z.string().trim().optional(),
      supervisorEmployeeId: z.string().trim().optional(),
      skipNotServed: z.boolean().optional(),
      skipAfterCutoff: z.boolean().optional(),
      forceNotServed: z.boolean().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success || !req.user) {
      return res.status(400).json({ error: "Invalid payload" });
    }
    const {
      from,
      to,
      meals,
      wantMeal,
      overrideReason,
      site,
      supervisorEmployeeId,
      skipNotServed,
      skipAfterCutoff,
      forceNotServed,
    } = parsed.data;
    const startDate = new Date(from);
    const endDate = new Date(to);
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || endDate < startDate) {
      return res.status(400).json({ error: "Invalid date range" });
    }
    const skipNotServedFlag = skipNotServed !== undefined ? skipNotServed : true;
    const skipAfterCutoffFlag = skipAfterCutoff !== undefined ? skipAfterCutoff : true;
    const forceNotServedFlag = forceNotServed === true;
    if (forceNotServedFlag && !overrideReason) {
      return res.status(400).json({ error: "OVERRIDE_REASON_REQUIRED" });
    }

    const settings = await getSettingsSnapshot();
    const timezone = settings?.timezone || getDefaultSettings().timezone;
    const dates = getDateRange(from, to);
    if (!dates.length) {
      return res.status(400).json({ error: "Invalid date range" });
    }

    const now = new Date();
    const blocked: Array<{ date: string; mealType: MealTypeType; reason: "OFFICE_CLOSED" | "MEAL_DISABLED" }> = [];
    const violations: Array<{ date: string; mealType: MealTypeType; cutoff: string; timezone: string }> = [];
    const allowedSlots: Array<{ date: string; mealType: MealTypeType }> = [];
    for (const date of dates) {
      if (isPastServiceDate(date, settings)) {
        return sendPastDate(res, { date, timezone });
      }
      const serviceDay = await getEffectiveServiceDay(date);
      for (const mealType of meals) {
        if (!isMealServed(serviceDay, mealType)) {
          if (forceNotServedFlag && overrideReason) {
            allowedSlots.push({ date, mealType });
          } else {
            blocked.push({
              date,
              mealType,
              reason: serviceDay.isOfficeOpen ? "MEAL_DISABLED" : "OFFICE_CLOSED",
            });
          }
          continue;
        }
        const cutoffDate = getCutoffDate(date, mealType, serviceDay, settings);
        if (now > cutoffDate) {
          if (overrideReason) {
            allowedSlots.push({ date, mealType });
          } else {
            violations.push({
              date,
              mealType,
              cutoff: getCutoffTimeLabel(mealType, serviceDay, settings),
              timezone,
            });
          }
          continue;
        }
        allowedSlots.push({ date, mealType });
      }
    }
    if (!skipNotServedFlag && blocked.length) {
      return res.status(400).json({ error: "MEAL_NOT_SERVED", details: { blocked } });
    }
    if (!skipAfterCutoffFlag && violations.length) {
      return res.status(400).json({ error: "CUTOFF_PASSED", details: { violations } });
    }
    const skipped = { blocked, violations };
    if (!allowedSlots.length) {
      return res.status(400).json({ error: "NOTHING_TO_APPLY", details: { skipped } });
    }

    let targetUsers: Array<{ id: string; employeeId: string }> = [];
    let scopeSite: string | null = null;
    let scopeSupervisorEmployeeId: string | null = null;
    if (req.user.role === Role.SUPERVISOR) {
      if (!req.user.site || isUnassignedValue(req.user.site)) {
        return res.status(400).json({ error: "SITE_REQUIRED" });
      }
      scopeSite = req.user.site;
      scopeSupervisorEmployeeId = req.user.employeeId ?? null;
      const assignments = await prisma.supervisorAssignment.findMany({
        where: { supervisorId: req.user.id },
        select: { employeeId: true },
      });
      const employeeIds = assignments.map((item) => item.employeeId);
      if (!employeeIds.length) {
        return res.json({
          ok: true,
          affectedUsers: 0,
          dates: dates.length,
          meals: meals.length,
          applied: { slots: allowedSlots.length },
          skipped,
          scope: { site: scopeSite, supervisorEmployeeId: scopeSupervisorEmployeeId },
        });
      }
      targetUsers = await prisma.user.findMany({
        where: {
          id: { in: employeeIds },
          role: Role.GROUND_STAFF,
          active: true,
          site: scopeSite,
        },
        select: { id: true, employeeId: true },
      });
    } else {
      if (!site || isUnassignedValue(site)) {
        return res.status(400).json({ error: "SITE_REQUIRED" });
      }
      const masterData = await getMasterDataSnapshot();
      const siteResolved = resolveMasterValue(site, masterData.sites);
      if (siteResolved.error || isUnassignedValue(siteResolved.value)) {
        return res.status(400).json({ error: "INVALID_SITE", allowed: masterData.sites });
      }
      scopeSite = siteResolved.value;
      let scopedUserIds: string[] | null = null;
      if (supervisorEmployeeId?.trim()) {
        const supervisor = await prisma.user.findFirst({
          where: { employeeId: supervisorEmployeeId.trim(), role: Role.SUPERVISOR, active: true },
          select: { id: true, employeeId: true, site: true },
        });
        if (!supervisor) {
          return res.status(404).json({ error: "Supervisor not found" });
        }
        if (!supervisor.site || isUnassignedValue(supervisor.site) || supervisor.site !== scopeSite) {
          return res.status(400).json({ error: "SUPERVISOR_SITE_MISMATCH" });
        }
        scopeSupervisorEmployeeId = supervisor.employeeId;
        const assignments = await prisma.supervisorAssignment.findMany({
          where: { supervisorId: supervisor.id },
          select: { employeeId: true },
        });
        scopedUserIds = assignments.map((item) => item.employeeId);
      }
      targetUsers = await prisma.user.findMany({
        where: {
          role: Role.GROUND_STAFF,
          active: true,
          site: scopeSite,
          ...(scopedUserIds ? { id: { in: scopedUserIds } } : {}),
        },
        select: { id: true, employeeId: true },
      });
    }

    if (!targetUsers.length) {
      return res.json({
        ok: true,
        affectedUsers: 0,
        dates: dates.length,
        meals: meals.length,
        applied: { slots: allowedSlots.length },
        skipped,
        scope: { site: scopeSite, supervisorEmployeeId: scopeSupervisorEmployeeId },
      });
    }

    const source = req.user.role === Role.SUPERVISOR ? Source.SUPERVISOR : Source.ADMIN;
    const actions: any[] = [];
    for (const user of targetUsers) {
      for (const slot of allowedSlots) {
        const dateValue = normalizeDateOnly(slot.date);
        actions.push(
          prisma.mealChoice.upsert({
            where: {
              userId_date_mealType: {
                userId: user.id,
                date: dateValue,
                mealType: slot.mealType,
              },
            },
            create: {
              userId: user.id,
              date: dateValue,
              mealType: slot.mealType,
              wantMeal,
              source,
              updatedById: req.user.id,
            },
            update: {
              wantMeal,
              source,
              updatedById: req.user.id,
            },
          })
        );
      }
    }
    if (actions.length) {
      await prisma.$transaction(actions);
    }

    await logAudit({
      actorId: req.user.id,
      action: "SUPERVISOR_GROUND_STAFF_BULK",
      entity: "MealChoice",
      reason: overrideReason ?? null,
      after: {
        from,
        to,
        meals,
        wantMeal,
        affectedUsers: targetUsers.length,
        applied: { slots: allowedSlots.length },
        skipped,
        scope: { site: scopeSite, supervisorEmployeeId: scopeSupervisorEmployeeId },
      },
    });

    return res.json({
      ok: true,
      affectedUsers: targetUsers.length,
      dates: dates.length,
      meals: meals.length,
      applied: { slots: allowedSlots.length },
      skipped,
      scope: { site: scopeSite, supervisorEmployeeId: scopeSupervisorEmployeeId },
    });
  }
);

router.get(
  "/supervisor/visitors/search",
  authMiddleware,
  requireRole([Role.SUPERVISOR, Role.ADMIN, Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (req, res) => {
    const query = firstString(req.query.q)?.trim() ?? "";
    if (!query) {
      return res.json([]);
    }
    const visitors = await prisma.visitor.findMany({
      where: {
        OR: [
          { name: { contains: query } },
          { phone: { contains: query } },
        ],
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true, phone: true, purpose: true },
      take: 10,
    });
    return res.json(visitors.map((visitor) => ({ ...visitor, company: visitor.purpose })));
  }
);

router.post(
  "/supervisor/visitors",
  authMiddleware,
  requireRole([Role.SUPERVISOR, Role.ADMIN, Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (req, res) => {
    const schema = z.object({
      name: z.string().trim().min(1),
      phone: z.string().trim().optional(),
      purpose: z.string().trim().optional(),
      company: z.string().trim().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success || !req.user) {
      return res.status(400).json({ error: "Invalid payload" });
    }
    const { name, phone, purpose, company } = parsed.data;
    const resolvedPurpose = purpose ?? company ?? null;
    if (phone) {
      const existing = await prisma.visitor.findFirst({
        where: { phone },
        select: { id: true, name: true, phone: true, purpose: true },
      });
      if (existing) {
        return res.json({ ...existing, company: existing.purpose });
      }
    }
    const visitor = await prisma.visitor.create({
      data: {
        name,
        phone: phone || null,
        purpose: resolvedPurpose,
        createdById: req.user.id,
      },
      select: { id: true, name: true, phone: true, purpose: true },
    });
    await logAudit({
      actorId: req.user.id,
      action: "CREATE_VISITOR",
      entity: "Visitor",
      entityId: visitor.id,
      after: visitor,
    });
    return res.json({ ...visitor, company: visitor.purpose });
  }
);

router.get(
  "/supervisor/visitors/:visitorId/meals",
  authMiddleware,
  requireRole([Role.SUPERVISOR, Role.ADMIN, Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (req, res) => {
    let dateParam: string;
    let visitorId: string;
    try {
      dateParam = mustString(req.query.date, "date");
      visitorId = mustString(req.params.visitorId, "visitorId");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return res.status(400).json({ error: message });
    }
    const parsed = dateOnlySchema.safeParse(dateParam);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid date" });
    }
    const date = parsed.data;
    const meals = await prisma.visitorMealChoice.findMany({
      where: { visitorId, date },
    });
    const map = new Map(meals.map((meal) => [meal.mealType, meal.wantMeal]));
    return res.json({
      date,
      breakfast: map.has(MealType.BREAKFAST) ? (map.get(MealType.BREAKFAST) ? "YES" : "NO") : null,
      lunch: map.has(MealType.LUNCH) ? (map.get(MealType.LUNCH) ? "YES" : "NO") : null,
      dinner: map.has(MealType.DINNER) ? (map.get(MealType.DINNER) ? "YES" : "NO") : null,
    });
  }
);

router.post(
  "/supervisor/visitors/:visitorId/meals",
  authMiddleware,
  requireRole([Role.SUPERVISOR, Role.ADMIN, Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (req, res) => {
    const schema = z.object({
      date: dateOnlySchema,
      breakfast: z.enum(["YES", "NO"]).nullable().optional(),
      lunch: z.enum(["YES", "NO"]).nullable().optional(),
      dinner: z.enum(["YES", "NO"]).nullable().optional(),
      overrideReason: z.string().trim().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success || !req.user) {
      return res.status(400).json({ error: "Invalid payload" });
    }
    let visitorId: string;
    try {
      visitorId = mustString(req.params.visitorId, "visitorId");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return res.status(400).json({ error: message });
    }
    const { date, breakfast, lunch, dinner, overrideReason } = parsed.data;
    const visitor = await prisma.visitor.findUnique({ where: { id: visitorId } });
    if (!visitor) {
      return res.status(404).json({ error: "Visitor not found" });
    }

    const settings = await getSettingsSnapshot();
    const timezone = settings?.timezone || getDefaultSettings().timezone;
    if (isPastServiceDate(date, settings)) {
      return sendPastDate(res, { date, timezone });
    }
    const serviceDay = await getEffectiveServiceDay(date);
    const meals: Array<{ mealType: MealTypeType; value: "YES" | "NO" | null | undefined }> = [
      { mealType: MealType.BREAKFAST, value: breakfast },
      { mealType: MealType.LUNCH, value: lunch },
      { mealType: MealType.DINNER, value: dinner },
    ];

    for (const meal of meals) {
      if (meal.value === undefined) continue;
      if (!isMealServed(serviceDay, meal.mealType)) {
        return sendMealNotServed(res, { date, mealType: meal.mealType });
      }
      const cutoffDate = getCutoffDate(date, meal.mealType, serviceDay, settings);
      if (new Date() > cutoffDate && !overrideReason) {
        return res.status(403).json({ error: "Override reason required after cutoff" });
      }
    }

    const actions: any[] = [];
    const summary: Record<string, string | null> = {};
    for (const meal of meals) {
      if (meal.value === undefined) continue;
      summary[meal.mealType] = meal.value ?? null;
      if (meal.value === null) {
        actions.push(
          prisma.visitorMealChoice.deleteMany({
            where: { visitorId, date, mealType: meal.mealType },
          })
        );
      } else {
        actions.push(
          prisma.visitorMealChoice.upsert({
            where: {
              visitorId_date_mealType: {
                visitorId,
                date,
                mealType: meal.mealType,
              },
            },
            create: {
              visitorId,
              date,
              mealType: meal.mealType,
              wantMeal: meal.value === "YES",
              createdById: req.user.id,
              overrideReason: overrideReason ?? null,
            },
            update: {
              wantMeal: meal.value === "YES",
              createdById: req.user.id,
              overrideReason: overrideReason ?? null,
            },
          })
        );
      }
    }

    if (actions.length) {
      await prisma.$transaction(actions);
    }

    await logAudit({
      actorId: req.user.id,
      action: "SUPERVISOR_VISITOR_MEAL_SET",
      entity: "VisitorMealChoice",
      entityId: visitorId,
      reason: overrideReason ?? null,
      after: { visitorId, date, meals: summary },
    });

    return res.json({ ok: true });
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
  "/admin/invites",
  authMiddleware,
  requireRole([Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (req, res) => {
    const schema = z.object({
      status: z.enum(["active", "used", "expired", "all"]).optional(),
      limit: z.coerce.number().int().min(1).max(500).optional(),
    });
    const parsed = schema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ error: "Invalid query params" });
    }

    const status = parsed.data.status || "all";
    const limit = parsed.data.limit ?? 200;
    const now = new Date();
    const invites = await prisma.userInvite.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        email: true,
        role: true,
        dept: true,
        site: true,
        supervisorEmployeeId: true,
        expiresAt: true,
        usedAt: true,
        createdAt: true,
        createdBy: {
          select: {
            employeeId: true,
            name: true,
          },
        },
      },
    });

    const items = invites
      .map((invite) => ({
        ...invite,
        status: getInviteStatus(invite, now),
      }))
      .filter((invite) => {
        if (status === "all") return true;
        if (status === "active") return invite.status === "ACTIVE";
        if (status === "used") return invite.status === "USED";
        return invite.status === "EXPIRED";
      });

    return res.json({ items });
  }
);

router.post(
  "/admin/invites",
  authMiddleware,
  requireRole([Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (req, res) => {
    const schema = z.object({
      email: z.string().trim().email(),
      role: z.nativeEnum(Role),
      dept: z.string().trim().optional(),
      site: z.string().trim().optional(),
      supervisorEmployeeId: z.string().trim().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success || !req.user) {
      return res.status(400).json({ error: "Invalid payload" });
    }
    const data = parsed.data;
    if (req.user.role === Role.HR_ADMIN && data.role === Role.SUPER_ADMIN) {
      return res.status(403).json({ error: "ROLE_NOT_ALLOWED" });
    }

    const email = normalizeEmail(data.email);
    if (!isAllowedInviteEmail(email)) {
      return res.status(400).json({
        error: "EMAIL_DOMAIN_NOT_ALLOWED",
        allowedDomain: getInviteAllowedDomain(),
      });
    }

    const masterData = await getMasterDataSnapshot();
    const deptResolved = resolveMasterValue(data.dept, masterData.departments);
    if (deptResolved.error) {
      return res.status(400).json({ error: "INVALID_DEPT", allowed: masterData.departments });
    }
    const siteResolved = resolveMasterValue(data.site, masterData.sites);
    if (siteResolved.error) {
      return res.status(400).json({ error: "INVALID_SITE", allowed: masterData.sites });
    }

    const supervisorEmployeeId = data.supervisorEmployeeId?.trim() || null;
    if (data.role === Role.GROUND_STAFF) {
      if (isUnassignedValue(siteResolved.value)) {
        return res.status(400).json({ error: "SITE_REQUIRED_FOR_GROUND_STAFF" });
      }
      if (!supervisorEmployeeId) {
        return res.status(400).json({ error: "SUPERVISOR_REQUIRED_FOR_GROUND_STAFF" });
      }
    }

    const [existingUserByEmail, supervisor] = await Promise.all([
      prisma.user.findFirst({
        where: { email },
        select: { id: true, employeeId: true },
      }),
      supervisorEmployeeId
        ? prisma.user.findFirst({
            where: { employeeId: supervisorEmployeeId, role: Role.SUPERVISOR, active: true },
            select: { id: true, employeeId: true, site: true },
          })
        : Promise.resolve(null),
    ]);

    if (existingUserByEmail) {
      return res.status(409).json({ error: "EMAIL_ALREADY_EXISTS" });
    }

    if (supervisorEmployeeId && !supervisor) {
      return res.status(404).json({ error: "Supervisor not found" });
    }
    if (data.role === Role.GROUND_STAFF) {
      if (!supervisor || isUnassignedValue(supervisor.site) || supervisor.site !== siteResolved.value) {
        return res.status(400).json({ error: "SUPERVISOR_SITE_MISMATCH" });
      }
    }

    const inviteToken = generateInviteToken();
    const tokenHash = hashInviteToken(inviteToken);
    const expiresAt = new Date(Date.now() + getInviteTtlHours() * 60 * 60 * 1000);

    const invite = await prisma.userInvite.upsert({
      where: { email },
      create: {
        email,
        role: data.role,
        dept: deptResolved.value,
        site: siteResolved.value,
        supervisorEmployeeId,
        tokenHash,
        expiresAt,
        createdByUserId: req.user.id,
      },
      update: {
        role: data.role,
        dept: deptResolved.value,
        site: siteResolved.value,
        supervisorEmployeeId,
        tokenHash,
        expiresAt,
        usedAt: null,
        createdByUserId: req.user.id,
      },
      select: {
        id: true,
        email: true,
        role: true,
        dept: true,
        site: true,
        supervisorEmployeeId: true,
        expiresAt: true,
        usedAt: true,
        createdAt: true,
      },
    });

    await logAudit({
      actorId: req.user.id,
      action: "CREATE_USER_INVITE",
      entity: "UserInvite",
      entityId: invite.id,
      after: {
        email: invite.email,
        role: invite.role,
        dept: invite.dept,
        site: invite.site,
        supervisorEmployeeId: invite.supervisorEmployeeId,
        expiresAt: invite.expiresAt,
      },
    });

    return res.json({
      invite,
      inviteLink: buildInviteLink(inviteToken),
    });
  }
);

router.post(
  "/admin/invites/:id/revoke",
  authMiddleware,
  requireRole([Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    let inviteId: string;
    try {
      inviteId = mustString(req.params.id, "id");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return res.status(400).json({ error: message });
    }
    const existing = await prisma.userInvite.findUnique({
      where: { id: inviteId },
      select: {
        id: true,
        email: true,
        role: true,
        dept: true,
        site: true,
        supervisorEmployeeId: true,
        expiresAt: true,
        usedAt: true,
      },
    });
    if (!existing) {
      return res.status(404).json({ error: "Invite not found" });
    }

    const now = new Date();
    const invite = await prisma.userInvite.update({
      where: { id: inviteId },
      data: {
        expiresAt: now,
      },
      select: {
        id: true,
        email: true,
        role: true,
        dept: true,
        site: true,
        supervisorEmployeeId: true,
        expiresAt: true,
        usedAt: true,
        createdAt: true,
      },
    });

    await logAudit({
      actorId: req.user.id,
      action: "REVOKE_USER_INVITE",
      entity: "UserInvite",
      entityId: invite.id,
      before: existing,
      after: invite,
    });

    return res.json({ invite });
  }
);

router.get(
  "/admin/users",
  authMiddleware,
  requireRole([Role.ADMIN, Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (req, res) => {
    const query = firstString(req.query.q)?.trim() ?? "";
    const users = await prisma.user.findMany({
      where: {
        ...(query
          ? {
              OR: [
                { employeeId: { contains: query } },
                { name: { contains: query } },
                { dept: { contains: query } },
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
        site: true,
        role: true,
        active: true,
      },
    });
    const assignments = users.length
      ? await prisma.supervisorAssignment.findMany({
          where: { employeeId: { in: users.map((user) => user.id) } },
          select: {
            employeeId: true,
            supervisor: { select: { employeeId: true } },
          },
        })
      : [];
    const assignmentMap = new Map(
      assignments.map((assignment) => [assignment.employeeId, assignment.supervisor.employeeId])
    );
    return res.json(
      users.map((user) => ({
        ...user,
        supervisorEmployeeId: assignmentMap.get(user.id) ?? null,
      }))
    );
  }
);

router.get(
  "/admin/visitors",
  authMiddleware,
  requireRole([Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (req, res) => {
    const from = firstString(req.query.from)?.trim();
    const to = firstString(req.query.to)?.trim();
    const status = firstString(req.query.status)?.trim() || "unused";
    const q = firstString(req.query.q)?.trim();
    const limitRaw = Number(firstString(req.query.limit) ?? 200);
    const limit = Number.isFinite(limitRaw) ? Math.min(500, Math.max(1, Math.floor(limitRaw))) : 200;

    if (!from || !dateOnlySchema.safeParse(from).success) {
      return res.status(400).json({ error: "Invalid from date" });
    }
    if (!to || !dateOnlySchema.safeParse(to).success) {
      return res.status(400).json({ error: "Invalid to date" });
    }
    if (!["unused", "used", "all"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const settings = await getSettingsSnapshot();
    const timezone = settings?.timezone || getDefaultSettings().timezone;
    const endExclusive = addDaysToDateString(to, 1);
    const createdAt = {
      gte: zonedTimeToUtc(from, "00:00", timezone),
      lt: zonedTimeToUtc(endExclusive, "00:00", timezone),
    };

    const where: any = { createdAt };
    if (status === "unused") {
      where.meals = { none: {} };
    } else if (status === "used") {
      where.meals = { some: {} };
    }
    if (q) {
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { phone: { contains: q, mode: "insensitive" } },
        { purpose: { contains: q, mode: "insensitive" } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.visitor.count({ where }),
      prisma.visitor.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          name: true,
          phone: true,
          purpose: true,
          createdAt: true,
          createdById: true,
          createdBy: { select: { employeeId: true, name: true, role: true } },
          _count: { select: { meals: true } },
        },
      }),
    ]);

    return res.json({
      total,
      items: items.map((visitor) => ({
        id: visitor.id,
        name: visitor.name,
        phone: visitor.phone,
        purpose: visitor.purpose,
        company: visitor.purpose,
        createdAt: visitor.createdAt,
        createdById: visitor.createdById,
        createdBy: visitor.createdBy,
        mealsCount: visitor._count.meals,
        mealsSaved: visitor._count.meals > 0,
      })),
    });
  }
);

router.delete(
  "/admin/visitors",
  authMiddleware,
  requireRole([Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (req, res) => {
    const schema = z.object({
      ids: z.array(z.string().trim().min(1)).min(1),
      mode: z.enum(["unusedOnly", "force"]).optional(),
      reason: z.string().trim().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success || !req.user) {
      return res.status(400).json({ error: "Invalid payload" });
    }
    const { ids, mode = "unusedOnly", reason } = parsed.data;
    if (mode === "force" && !reason?.trim()) {
      return res.status(400).json({ error: "REASON_REQUIRED" });
    }

    const visitors = await prisma.visitor.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        phone: true,
        purpose: true,
        createdAt: true,
        createdById: true,
        _count: { select: { meals: true } },
      },
    });

    const deleted: Array<{ id: string; name: string }> = [];
    const skipped: Array<{ id: string; name: string; reason: string }> = [];
    const deletable = visitors.filter((visitor) => {
      if (mode === "force") return true;
      if (visitor._count.meals > 0) {
        skipped.push({ id: visitor.id, name: visitor.name, reason: "HAS_MEALS" });
        return false;
      }
      return true;
    });

    const idsToDelete = deletable.map((visitor) => visitor.id);
    if (idsToDelete.length) {
      await prisma.$transaction(async (tx) => {
        if (mode === "force") {
          await tx.visitorMealChoice.deleteMany({ where: { visitorId: { in: idsToDelete } } });
        }
        await tx.visitor.deleteMany({ where: { id: { in: idsToDelete } } });
      });

      for (const visitor of deletable) {
        deleted.push({ id: visitor.id, name: visitor.name });
        await logAudit({
          actorId: req.user.id,
          action: "DELETE_VISITOR",
          entity: "Visitor",
          entityId: visitor.id,
          reason: reason?.trim() || "cleanup",
          before: {
            id: visitor.id,
            name: visitor.name,
            phone: visitor.phone,
            purpose: visitor.purpose,
            mealsCount: visitor._count.meals,
            createdAt: visitor.createdAt,
            createdById: visitor.createdById,
          },
          after: null,
        });
      }
    }

    return res.json({ ok: true, deleted, skipped });
  }
);

router.post(
  "/admin/users",
  authMiddleware,
  requireRole([Role.ADMIN, Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (req, res) => {
    const schema = z.object({
      employeeId: z.string().trim().min(1),
      name: z.string().trim().min(1),
      dept: z.string().trim().optional(),
      site: z.string().trim().optional(),
      role: z.nativeEnum(Role),
      supervisorEmployeeId: z.string().trim().optional(),
      pin: z.string().trim().min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success || !req.user) {
      return res.status(400).json({ error: "Invalid payload" });
    }
    const data = parsed.data;
    if (req.user.role === Role.ADMIN) {
      const allowedRoles = new Set<string>([Role.EMPLOYEE, Role.SUPERVISOR, Role.GROUND_STAFF]);
      if (!allowedRoles.has(String(data.role))) {
        return res.status(403).json({ error: "ROLE_NOT_ALLOWED" });
      }
    }
    if (req.user.role === Role.HR_ADMIN && data.role === Role.SUPER_ADMIN) {
      return res.status(403).json({ error: "ROLE_NOT_ALLOWED" });
    }
    const masterData = await getMasterDataSnapshot();
    const deptResolved = resolveMasterValue(data.dept, masterData.departments);
    if (deptResolved.error) {
      return res.status(400).json({ error: "INVALID_DEPT", allowed: masterData.departments });
    }
    const siteResolved = resolveMasterValue(data.site, masterData.sites);
    if (siteResolved.error) {
      return res.status(400).json({ error: "INVALID_SITE", allowed: masterData.sites });
    }
    const supervisorEmployeeId = data.supervisorEmployeeId?.trim() || null;
    if (data.role === Role.GROUND_STAFF) {
      if (isUnassignedValue(siteResolved.value)) {
        return res.status(400).json({ error: "SITE_REQUIRED_FOR_GROUND_STAFF" });
      }
      if (!supervisorEmployeeId) {
        return res.status(400).json({ error: "SUPERVISOR_REQUIRED_FOR_GROUND_STAFF" });
      }
    }
    const supervisor = supervisorEmployeeId
      ? await prisma.user.findFirst({
          where: { employeeId: supervisorEmployeeId, role: Role.SUPERVISOR, active: true },
          select: { id: true, employeeId: true, site: true },
        })
      : null;
    if (supervisorEmployeeId && !supervisor) {
      return res.status(404).json({ error: "Supervisor not found" });
    }
    if (data.role === Role.GROUND_STAFF) {
      if (!supervisor || isUnassignedValue(supervisor.site) || supervisor.site !== siteResolved.value) {
        return res.status(400).json({ error: "SUPERVISOR_SITE_MISMATCH" });
      }
    }
    const pinHash = await bcrypt.hash(data.pin, 10);
    const user = await prisma.user.create({
      data: {
        employeeId: data.employeeId,
        name: data.name,
        dept: deptResolved.value,
        site: siteResolved.value,
        role: data.role,
        pinHash,
        authProvider: "PIN",
        active: true,
      },
      select: {
        id: true,
        employeeId: true,
        name: true,
        dept: true,
        site: true,
        role: true,
        active: true,
      },
    });
    if (supervisor) {
      await prisma.supervisorAssignment.upsert({
        where: { employeeId: user.id },
        create: {
          employeeId: user.id,
          supervisorId: supervisor.id,
        },
        update: {
          supervisorId: supervisor.id,
        },
      });
    }
    await logAudit({
      actorId: req.user.id,
      action: "CREATE_USER",
      entity: "User",
      entityId: user.id,
      after: {
        employeeId: user.employeeId,
        role: user.role,
        dept: user.dept,
        site: user.site,
        active: user.active,
        supervisorEmployeeId: supervisorEmployeeId,
      },
    });
    return res.json(user);
  }
);

router.put(
  "/admin/users/:id",
  authMiddleware,
  requireRole([Role.ADMIN, Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (req, res) => {
    const schema = z.object({
      name: z.string().trim().optional(),
      dept: z.string().trim().nullable().optional(),
      site: z.string().trim().nullable().optional(),
      role: z.nativeEnum(Role).optional(),
      active: z.boolean().optional(),
      supervisorEmployeeId: z.string().trim().nullable().optional(),
      reason: z.string().trim().optional(),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success || !req.user) {
      return res.status(400).json({ error: "Invalid payload" });
    }
    let userId: string;
    try {
      userId = mustString(req.params.id, "id");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return res.status(400).json({ error: message });
    }
    const existing = await prisma.user.findUnique({ where: { id: userId } });
    if (!existing) {
      return res.status(404).json({ error: "User not found" });
    }
    const data = parsed.data;
    const effectiveRole = data.role ?? existing.role;
    if (req.user.role === Role.ADMIN) {
      const allowedRoles = new Set<string>([Role.EMPLOYEE, Role.SUPERVISOR, Role.GROUND_STAFF]);
      if (existing.role === Role.HR_ADMIN || existing.role === Role.SUPER_ADMIN) {
        return res.status(403).json({ error: "TARGET_ROLE_PROTECTED" });
      }
      if (data.role !== undefined && !allowedRoles.has(String(data.role))) {
        return res.status(403).json({ error: "ROLE_NOT_ALLOWED" });
      }
    }
    if (req.user.role === Role.HR_ADMIN) {
      if (existing.role === Role.SUPER_ADMIN) {
        return res.status(403).json({ error: "TARGET_ROLE_PROTECTED" });
      }
      if (data.role === Role.SUPER_ADMIN) {
        return res.status(403).json({ error: "ROLE_NOT_ALLOWED" });
      }
    }
    const masterData = await getMasterDataSnapshot();
    let deptValue: string | null | undefined = undefined;
    if (data.dept !== undefined) {
      const resolved = resolveMasterValue(data.dept, masterData.departments);
      if (resolved.error) {
        return res.status(400).json({ error: "INVALID_DEPT", allowed: masterData.departments });
      }
      deptValue = resolved.value;
    }
    let siteValue: string | null | undefined = undefined;
    if (data.site !== undefined) {
      const resolved = resolveMasterValue(data.site, masterData.sites);
      if (resolved.error) {
        return res.status(400).json({ error: "INVALID_SITE", allowed: masterData.sites });
      }
      siteValue = resolved.value;
    }
    const nextSite = data.site !== undefined ? siteValue : existing.site;
    let supervisorEmployeeIdValue: string | null | undefined = undefined;
    if (data.supervisorEmployeeId !== undefined) {
      const trimmed = data.supervisorEmployeeId?.trim() ?? "";
      supervisorEmployeeIdValue = trimmed ? trimmed : null;
    }
    if (effectiveRole === Role.GROUND_STAFF) {
      if (isUnassignedValue(nextSite)) {
        return res.status(400).json({ error: "SITE_REQUIRED_FOR_GROUND_STAFF" });
      }
      if (supervisorEmployeeIdValue === null) {
        return res.status(400).json({ error: "SUPERVISOR_REQUIRED_FOR_GROUND_STAFF" });
      }
      if (supervisorEmployeeIdValue === undefined) {
        const existingAssignment = await prisma.supervisorAssignment.findUnique({
          where: { employeeId: existing.id },
          select: { supervisor: { select: { employeeId: true } } },
        });
        if (!existingAssignment) {
          return res.status(400).json({ error: "SUPERVISOR_REQUIRED_FOR_GROUND_STAFF" });
        }
        supervisorEmployeeIdValue = existingAssignment.supervisor.employeeId;
      }
    }
    const supervisor = supervisorEmployeeIdValue
      ? await prisma.user.findFirst({
          where: { employeeId: supervisorEmployeeIdValue, role: Role.SUPERVISOR, active: true },
          select: { id: true, employeeId: true, site: true },
        })
      : null;
    if (supervisorEmployeeIdValue && !supervisor) {
      return res.status(404).json({ error: "Supervisor not found" });
    }
    if (effectiveRole === Role.GROUND_STAFF) {
      if (!supervisor || isUnassignedValue(supervisor.site) || supervisor.site !== nextSite) {
        return res.status(400).json({ error: "SUPERVISOR_SITE_MISMATCH" });
      }
    }
    const user = await prisma.user.update({
      where: { id: existing.id },
      data: {
        ...(data.name !== undefined ? { name: data.name } : {}),
        ...(deptValue !== undefined ? { dept: deptValue } : {}),
        ...(siteValue !== undefined ? { site: siteValue } : {}),
        ...(data.role !== undefined ? { role: data.role } : {}),
        ...(data.active !== undefined ? { active: data.active } : {}),
      },
      select: {
        id: true,
        employeeId: true,
        name: true,
        dept: true,
        site: true,
        role: true,
        active: true,
      },
    });
    if (supervisorEmployeeIdValue !== undefined) {
      if (supervisorEmployeeIdValue === null) {
        await prisma.supervisorAssignment.deleteMany({
          where: { employeeId: existing.id },
        });
      } else if (supervisor) {
        await prisma.supervisorAssignment.upsert({
          where: { employeeId: existing.id },
          create: {
            employeeId: existing.id,
            supervisorId: supervisor.id,
          },
          update: {
            supervisorId: supervisor.id,
          },
        });
      }
    }
    const auditBefore = {
      name: existing.name,
      dept: existing.dept,
      site: existing.site,
      role: existing.role,
      active: existing.active,
    };
    const auditAfter: {
      name: string;
      dept: string | null;
      site: string | null;
      role: Role;
      active: boolean;
      supervisorEmployeeId?: string | null;
    } = {
      name: user.name,
      dept: user.dept,
      site: user.site,
      role: user.role,
      active: user.active,
    };
    if (supervisorEmployeeIdValue !== undefined) {
      auditAfter.supervisorEmployeeId = supervisorEmployeeIdValue;
    }
    await logAudit({
      actorId: req.user.id,
      action: "UPDATE_USER",
      entity: "User",
      entityId: user.id,
      reason: data.reason ?? null,
      before: auditBefore,
      after: auditAfter,
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
    let userId: string;
    try {
      userId = mustString(req.params.id, "id");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return res.status(400).json({ error: message });
    }
    const user = await prisma.user.findUnique({ where: { id: userId } });
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
  requireRole([Role.ADMIN, Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (req, res) => {
    const schema = z.object({
      users: z.array(
        z.object({
          employeeId: z.string().trim().min(1),
          name: z.string().trim().min(1),
          dept: z.string().trim().optional(),
          site: z.string().trim().optional(),
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
    if (req.user.role === Role.ADMIN) {
      const allowedRoles = new Set<string>([Role.EMPLOYEE, Role.SUPERVISOR, Role.GROUND_STAFF]);
      const invalid = parsed.data.users.find((item) => !allowedRoles.has(String(item.role)));
      if (invalid) {
        return res.status(403).json({ error: "ROLE_NOT_ALLOWED" });
      }
      const employeeIds = Array.from(
        new Set(parsed.data.users.map((item) => item.employeeId).filter(Boolean))
      );
      if (employeeIds.length) {
        const protectedUsers = await prisma.user.findMany({
          where: {
            employeeId: { in: employeeIds },
            role: { in: [Role.HR_ADMIN, Role.SUPER_ADMIN] },
          },
          select: { employeeId: true },
        });
        if (protectedUsers.length) {
          return res.status(403).json({ error: "TARGET_ROLE_PROTECTED" });
        }
      }
    }
    if (req.user.role === Role.HR_ADMIN) {
      const invalid = parsed.data.users.find((item) => item.role === Role.SUPER_ADMIN);
      if (invalid) {
        return res.status(403).json({ error: "ROLE_NOT_ALLOWED" });
      }
      const employeeIds = Array.from(
        new Set(parsed.data.users.map((item) => item.employeeId).filter(Boolean))
      );
      if (employeeIds.length) {
        const protectedUsers = await prisma.user.findMany({
          where: {
            employeeId: { in: employeeIds },
            role: Role.SUPER_ADMIN,
          },
          select: { employeeId: true },
        });
        if (protectedUsers.length) {
          return res.status(403).json({ error: "TARGET_ROLE_PROTECTED" });
        }
      }
    }
    const masterData = await getMasterDataSnapshot();
    const results = [];
    for (const item of parsed.data.users) {
      const deptResolved = resolveMasterValue(item.dept, masterData.departments);
      if (deptResolved.error) {
        return res.status(400).json({ error: "INVALID_DEPT", allowed: masterData.departments });
      }
      const siteResolved = resolveMasterValue(item.site, masterData.sites);
      if (siteResolved.error) {
        return res.status(400).json({ error: "INVALID_SITE", allowed: masterData.sites });
      }
      const pinHash = await bcrypt.hash(item.pin, 10);
      const user = await prisma.user.upsert({
        where: { employeeId: item.employeeId },
        create: {
          employeeId: item.employeeId,
          name: item.name,
          dept: deptResolved.value,
          site: siteResolved.value,
          role: item.role,
          pinHash,
          authProvider: "PIN",
          active: true,
        },
        update: {
          name: item.name,
          dept: deptResolved.value,
          site: siteResolved.value,
          role: item.role,
          pinHash,
          authProvider: "PIN",
          active: true,
        },
        select: {
          id: true,
          employeeId: true,
          role: true,
          dept: true,
          site: true,
          active: true,
        },
      });
      await logAudit({
        actorId: req.user.id,
        action: "IMPORT_USER",
        entity: "User",
        entityId: user.id,
        reason: parsed.data.reason ?? null,
        after: { employeeId: user.employeeId, role: user.role, dept: user.dept, site: user.site, active: user.active },
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
      ? await prisma.user.findFirst({
          where: { employeeId: parsed.data.supervisorEmployeeId, role: Role.SUPERVISOR, active: true },
          select: { id: true, employeeId: true, site: true },
        })
      : null;

    if (parsed.data.supervisorEmployeeId && !supervisor) {
      return res.status(404).json({ error: "Supervisor not found" });
    }
    if (
      employee.role === Role.GROUND_STAFF &&
      parsed.data.supervisorEmployeeId &&
      (!employee.site ||
        isUnassignedValue(employee.site) ||
        isUnassignedValue(supervisor?.site) ||
        supervisor?.site !== employee.site)
    ) {
      return res.status(400).json({ error: "SUPERVISOR_SITE_MISMATCH" });
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
    let userId: string;
    try {
      userId = mustString(req.query.userId, "userId").trim();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return res.status(400).json({ error: message });
    }
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
        const templateFromSettings = getTemplateForDate(dateStr, settings);
        let resolvedTemplate = template
          ? { ...template }
          : {
              officeOpen: templateFromSettings.isOfficeOpen,
              breakfastServed: templateFromSettings.breakfastServed,
              lunchServed: templateFromSettings.lunchServed,
              dinnerServed: templateFromSettings.dinnerServed,
            };
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
      settings: z.record(z.string(), z.string()),
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
      "cutoffDayOffset.breakfast",
      "cutoffDayOffset.lunch",
      "cutoffDayOffset.dinner",
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
  "/admin/audit-meta",
  authMiddleware,
  requireRole([Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (_req, res) => {
    const [actions, entities] = await Promise.all([
      prisma.auditLog.findMany({
        distinct: ["action"],
        select: { action: true },
        orderBy: { action: "asc" },
      }),
      prisma.auditLog.findMany({
        distinct: ["entity"],
        select: { entity: true },
        orderBy: { entity: "asc" },
      }),
    ]);
    return res.json({
      actions: actions.map((item) => item.action).filter(Boolean),
      entities: entities.map((item) => item.entity).filter(Boolean),
    });
  }
);

router.get(
  "/admin/audit-logs",
  authMiddleware,
  requireRole([Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (req, res) => {
    const pageRaw = Number(firstString(req.query.page) ?? 1);
    const pageSizeRaw = Number(firstString(req.query.pageSize) ?? 50);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
    const pageSize = Number.isFinite(pageSizeRaw)
      ? Math.min(200, Math.max(1, Math.floor(pageSizeRaw)))
      : 50;
    const from = firstString(req.query.from)?.trim();
    const to = firstString(req.query.to)?.trim();
    const action = firstString(req.query.action)?.trim();
    const entity = firstString(req.query.entity)?.trim();
    const q = firstString(req.query.q)?.trim();

    if (from && !dateOnlySchema.safeParse(from).success) {
      return res.status(400).json({ error: "Invalid from date" });
    }
    if (to && !dateOnlySchema.safeParse(to).success) {
      return res.status(400).json({ error: "Invalid to date" });
    }

    const settings = await getSettingsSnapshot();
    const timezone = settings?.timezone || getDefaultSettings().timezone;

    // Interpret from/to as local dates in settings.timezone.
    // Inclusive "to" => endExclusive at local midnight of (to + 1 day).
    const createdAt: { gte?: Date; lt?: Date } = {};
    if (from) {
      createdAt.gte = zonedTimeToUtc(from, "00:00", timezone);
    }
    if (to) {
      const endExclusive = addDaysToDateString(to, 1);
      createdAt.lt = zonedTimeToUtc(endExclusive, "00:00", timezone);
    }

    const where: any = {};
    if (Object.keys(createdAt).length) {
      where.createdAt = createdAt;
    }
    if (action) {
      where.action = action;
    }
    if (entity) {
      where.entity = entity;
    }
    if (q) {
      where.OR = [
        { reason: { contains: q, mode: "insensitive" } },
        { entityId: { contains: q, mode: "insensitive" } },
        { action: { contains: q, mode: "insensitive" } },
        { entity: { contains: q, mode: "insensitive" } },
        { actor: { is: { name: { contains: q, mode: "insensitive" } } } },
        { actor: { is: { employeeId: { contains: q, mode: "insensitive" } } } },
      ];
    }

    const [total, items] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" }, // newest first
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          actor: {
            select: {
              id: true,
              employeeId: true,
              name: true,
              role: true,
            },
          },
        },
      }),
    ]);

    const sanitizedItems = items.map((item) => ({
      ...item,
      before: sanitizeAuditJson(item.before),
      after: sanitizeAuditJson(item.after),
    }));

    return res.json({
      page,
      pageSize,
      total,
      items: sanitizedItems,
    });
  }
);

router.get(
  "/admin/master-data",
  authMiddleware,
  requireRole([Role.ADMIN, Role.HR_ADMIN, Role.SUPER_ADMIN]),
  async (_req, res) => {
    const masterData = await getMasterDataSnapshot();
    const usage = await getMasterDataUsage(masterData);
    return res.json({
      departments: masterData.departments,
      sites: masterData.sites,
      usage,
    });
  }
);

router.put(
  "/admin/master-data",
  authMiddleware,
  requireRole([Role.SUPER_ADMIN]),
  async (req, res) => {
    const schema = z.object({
      departments: z.array(z.string()),
      sites: z.array(z.string()),
      reason: z.string().trim().min(1),
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success || !req.user) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const masterBefore = await getMasterDataSnapshot();
    const attemptPayload = {
      departments: parsed.data.departments,
      sites: parsed.data.sites,
    };

    if (!hasUnassigned(parsed.data.departments)) {
      await logAudit({
        actorId: req.user.id,
        action: "UPDATE_MASTER_DATA",
        entity: "AppSetting",
        reason: parsed.data.reason,
        before: masterBefore,
        after: { ...attemptPayload, blocked: true, error: "CANNOT_REMOVE_UNASSIGNED" },
      });
      return res.status(409).json({
        error: "CANNOT_REMOVE_UNASSIGNED",
        field: "departments",
        value: UNASSIGNED_LABEL,
      });
    }
    if (!hasUnassigned(parsed.data.sites)) {
      await logAudit({
        actorId: req.user.id,
        action: "UPDATE_MASTER_DATA",
        entity: "AppSetting",
        reason: parsed.data.reason,
        before: masterBefore,
        after: { ...attemptPayload, blocked: true, error: "CANNOT_REMOVE_UNASSIGNED" },
      });
      return res.status(409).json({
        error: "CANNOT_REMOVE_UNASSIGNED",
        field: "sites",
        value: UNASSIGNED_LABEL,
      });
    }

    const departmentsNormalized = normalizeMasterList(parsed.data.departments, true);
    if (departmentsNormalized.error) {
      return res.status(400).json({ error: departmentsNormalized.error });
    }
    const sitesNormalized = normalizeMasterList(parsed.data.sites, true);
    if (sitesNormalized.error) {
      return res.status(400).json({ error: sitesNormalized.error });
    }

    const usageRaw = await getMasterDataUsageRaw();
    const missingDepartments = Object.keys(usageRaw.departments).filter((value) => {
      if (usageRaw.departments[value] <= 0) return false;
      return !departmentsNormalized.values.some(
        (allowed) => allowed.toLowerCase() === value.toLowerCase()
      );
    });
    const missingSites = Object.keys(usageRaw.sites).filter((value) => {
      if (usageRaw.sites[value] <= 0) return false;
      return !sitesNormalized.values.some(
        (allowed) => allowed.toLowerCase() === value.toLowerCase()
      );
    });

    if (missingDepartments.length || missingSites.length) {
      await logAudit({
        actorId: req.user.id,
        action: "UPDATE_MASTER_DATA",
        entity: "AppSetting",
        reason: parsed.data.reason,
        before: masterBefore,
        after: {
          ...attemptPayload,
          blocked: true,
          error: "CANNOT_REMOVE_IN_USE",
          missingDepartments,
          missingSites,
        },
      });
      return res.status(409).json({
        error: "CANNOT_REMOVE_IN_USE",
        missingDepartments,
        missingSites,
      });
    }

    const existing = await prisma.appSetting.findMany({
      where: { key: { in: ["master.departments", "master.sites"] } },
    });
    const existingDept = existing.find((item) => item.key === "master.departments")?.value;
    const existingSites = existing.find((item) => item.key === "master.sites")?.value;
    const before = {
      departments: normalizeMasterList(
        parseMasterSettingValue(existingDept),
        false
      ).values,
      sites: normalizeMasterList(
        parseMasterSettingValue(existingSites),
        false
      ).values,
    };

    await prisma.$transaction([
      prisma.appSetting.upsert({
        where: { key: "master.departments" },
        create: {
          key: "master.departments",
          value: JSON.stringify(departmentsNormalized.values),
          updatedById: req.user.id,
        },
        update: {
          value: JSON.stringify(departmentsNormalized.values),
          updatedById: req.user.id,
        },
      }),
      prisma.appSetting.upsert({
        where: { key: "master.sites" },
        create: {
          key: "master.sites",
          value: JSON.stringify(sitesNormalized.values),
          updatedById: req.user.id,
        },
        update: {
          value: JSON.stringify(sitesNormalized.values),
          updatedById: req.user.id,
        },
      }),
    ]);

    masterDataCache = null;
    await logAudit({
      actorId: req.user.id,
      action: "UPDATE_MASTER_DATA",
      entity: "AppSetting",
      reason: parsed.data.reason,
      before,
      after: {
        departments: departmentsNormalized.values,
        sites: sitesNormalized.values,
      },
    });

    return res.json({
      departments: departmentsNormalized.values,
      sites: sitesNormalized.values,
    });
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
      if (!reqUser.site || isUnassignedValue(reqUser.site)) {
        return res.json([]);
      }
      const assignments = await prisma.supervisorAssignment.findMany({
        where: { supervisorId: reqUser.id },
        select: { employeeId: true },
      });
      userIds = assignments.map((item) => item.employeeId);
    } else if (reqUser.role === Role.ADMIN || reqUser.role === Role.HR_ADMIN || reqUser.role === Role.SUPER_ADMIN) {
      userIds = null;
    } else {
      userIds = [reqUser.id];
    }

    const users = await prisma.user.findMany({
      where: {
        active: true,
        ...(userIds ? { id: { in: userIds } } : {}),
        ...(reqUser.role === Role.SUPERVISOR ? { site: reqUser.site } : {}),
      },
      orderBy: { employeeId: "asc" },
      select: {
        id: true,
        employeeId: true,
        name: true,
        dept: true,
        site: true,
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
    let dateParam: string;
    try {
      dateParam = mustString(req.query.date, "date");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return res.status(400).json({ error: message });
    }
    const parsed = dateOnlySchema.safeParse(dateParam);
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

    const [choices, preferences, approvedRequests, visitorMeals] = await Promise.all([
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
      prisma.visitorMealChoice.findMany({
        where: { date: dateStr },
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

    const visitorCounts = {
      BREAKFAST: { yes: 0, no: 0 },
      LUNCH: { yes: 0, no: 0 },
      DINNER: { yes: 0, no: 0 },
    };
    for (const visitorMeal of visitorMeals) {
      if (visitorMeal.wantMeal) {
        visitorCounts[visitorMeal.mealType].yes += 1;
      } else {
        visitorCounts[visitorMeal.mealType].no += 1;
      }
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
        counts[mealType].notSet += 1;
        deptBreakdown[dept][mealType].notSet += 1;
      }
    }

    for (const mealType of [MealType.BREAKFAST, MealType.LUNCH, MealType.DINNER]) {
      if (!served[mealType]) continue;
      counts[mealType].yes += visitorCounts[mealType].yes;
      counts[mealType].no += visitorCounts[mealType].no;
      if (!deptBreakdown.Visitors) {
        deptBreakdown.Visitors = {
          BREAKFAST: served.BREAKFAST ? { yes: 0, no: 0, notSet: 0 } : null,
          LUNCH: served.LUNCH ? { yes: 0, no: 0, notSet: 0 } : null,
          DINNER: served.DINNER ? { yes: 0, no: 0, notSet: 0 } : null,
        };
      }
      deptBreakdown.Visitors[mealType].yes += visitorCounts[mealType].yes;
      deptBreakdown.Visitors[mealType].no += visitorCounts[mealType].no;
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

    const [choices, preferences, requests, checkins, visitorMeals, visitorList] = await Promise.all([
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
      prisma.visitorMealChoice.findMany({
        where: { date: dateValue },
      }),
      prisma.visitor.findMany({
        select: { id: true, name: true, phone: true, purpose: true },
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
        const rowKey = mealTypeKey(meal);
        const request = requestMap.get(key);
        if (!availability) {
          row[rowKey] = {
            selected: "NA",
            preference: "NA",
            final: "NA",
            source: "NA",
            requestStatus: request?.status ?? null,
          };
          continue;
        }
        const explicit = choiceMap.get(key);
        const preference = prefMap.get(key);
        const selected = explicit ? (explicit.wantMeal ? "YES" : "NO") : "NOT_SET";
        const preferenceValue = preference ? (preference.defaultWantMeal ? "YES" : "NO") : "NOT_SET";
        const final = selected;
        const source = explicit ? "EXPLICIT" : "NOT_SET";
        if (explicit) {
          row[rowKey] = {
            selected,
            preference: preferenceValue,
            final,
            source,
            requestStatus: request?.status ?? null,
          };
          continue;
        }
        row[rowKey] = {
          selected,
          preference: preferenceValue,
          final,
          source,
          requestStatus: request?.status ?? null,
        };
      }
      return row;
    });

    const visitorMap = new Map(visitorList.map((visitor) => [visitor.id, visitor]));
    const visitors = visitorMeals.length
      ? Array.from(
          visitorMeals
            .reduce(
              (map, meal) => {
                const existing = map.get(meal.visitorId);
                const visitor = visitorMap.get(meal.visitorId);
                if (!existing && visitor) {
                  map.set(meal.visitorId, {
                    id: visitor.id,
                    name: visitor.name,
                    phone: visitor.phone,
                    purpose: visitor.purpose,
                    breakfast: null,
                    lunch: null,
                    dinner: null,
                  });
                }
                const row = map.get(meal.visitorId);
                if (row) {
                  const key = mealTypeKey(meal.mealType);
                  row[key] = meal.wantMeal ? "YES" : "NO";
                }
                return map;
              },
              new Map<
                string,
                {
                  id: string;
                  name: string;
                  phone: string | null;
                  purpose: string | null;
                  breakfast: string | null;
                  lunch: string | null;
                  dinner: string | null;
                }
              >()
            )
            .values()
        ).map((item) => ({
          ...item,
          company: item.purpose,
          breakfast: item.breakfast ?? "NOT_SET",
          lunch: item.lunch ?? "NOT_SET",
          dinner: item.dinner ?? "NOT_SET",
        }))
      : [];

    return res.json({
      date: dateValue,
      officeOpen,
      serviceDay: {
        breakfastServed: served.BREAKFAST,
        lunchServed: served.LUNCH,
        dinnerServed: served.DINNER,
      },
      rows,
      visitors,
    });
  }
);

export default router;
export { normalizeDateOnly };
