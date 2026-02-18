import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const SENSITIVE_KEYS = new Set([
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
    if (SENSITIVE_KEYS.has(key.toLowerCase())) continue;
    output[key] = redactSensitive(val);
  }
  return output;
}

function sanitizeJson(value: string | null): string | null {
  if (!value) return value;
  try {
    const parsed = JSON.parse(value);
    return JSON.stringify(redactSensitive(parsed));
  } catch {
    return value;
  }
}

async function main() {
  const logs = await prisma.auditLog.findMany({
    select: { id: true, before: true, after: true },
  });

  let updated = 0;
  for (const log of logs) {
    const nextBefore = sanitizeJson(log.before);
    const nextAfter = sanitizeJson(log.after);
    if (nextBefore !== log.before || nextAfter !== log.after) {
      await prisma.auditLog.update({
        where: { id: log.id },
        data: { before: nextBefore, after: nextAfter },
      });
      updated += 1;
    }
  }

  console.log(`Scanned ${logs.length} audit log rows, updated ${updated}.`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
