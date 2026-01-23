import "dotenv/config";
import bcrypt from "bcryptjs";
import prismaPkg from "@prisma/client";

const { PrismaClient, MealType, Role } = prismaPkg as unknown as {
  PrismaClient: typeof import("@prisma/client").PrismaClient;
  MealType: typeof import("@prisma/client").MealType;
  Role: typeof import("@prisma/client").Role;
};
type MealTypeType = (typeof MealType)[keyof typeof MealType];
type RoleType = (typeof Role)[keyof typeof Role];

const prisma = new PrismaClient();

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function main() {
  const pinHash = await bcrypt.hash("1234", 10);

  const users = [
    {
      employeeId: "A1001",
      name: "Admin User",
      role: Role.SUPER_ADMIN,
      dept: "IT",
    },
    {
      employeeId: "H2001",
      name: "HR Admin",
      role: Role.HR_ADMIN,
      dept: "People",
    },
    {
      employeeId: "S3001",
      name: "Supervisor One",
      role: Role.SUPERVISOR,
      dept: "Facilities",
    },
    {
      employeeId: "E4001",
      name: "Employee One",
      role: Role.EMPLOYEE,
      dept: "Operations",
    },
    {
      employeeId: "G5001",
      name: "Ground Staff",
      role: Role.GROUND_STAFF,
      dept: "Cafeteria",
    },
  ];

  const idByEmployeeId: Record<string, string> = {};
  for (const user of users) {
    const upserted = await prisma.user.upsert({
      where: { employeeId: user.employeeId },
      create: {
        employeeId: user.employeeId,
        name: user.name,
        role: user.role,
        dept: user.dept,
        pinHash,
        active: true,
      },
      update: {
        name: user.name,
        role: user.role,
        dept: user.dept,
        pinHash,
        active: true,
      },
    });
    idByEmployeeId[user.employeeId] = upserted.id;
  }

  if (idByEmployeeId.E4001 && idByEmployeeId.S3001) {
    await prisma.supervisorAssignment.upsert({
      where: { employeeId: idByEmployeeId.E4001 },
      create: {
        employeeId: idByEmployeeId.E4001,
        supervisorId: idByEmployeeId.S3001,
      },
      update: {
        supervisorId: idByEmployeeId.S3001,
      },
    });
  }

  if (idByEmployeeId.E4001) {
    const existing = await prisma.mealPreference.findFirst({
      where: { userId: idByEmployeeId.E4001, mealType: MealType.LUNCH },
    });
    if (existing) {
      await prisma.mealPreference.update({
        where: { id: existing.id },
        data: {
          defaultWantMeal: true,
          daysMask: 31,
          active: true,
        },
      });
    } else {
      await prisma.mealPreference.create({
        data: {
          userId: idByEmployeeId.E4001,
          mealType: MealType.LUNCH,
          defaultWantMeal: true,
          daysMask: 31,
          active: true,
        },
      });
    }
  }

  const settings = [
    { key: "timezone", value: "Asia/Kolkata" },
    { key: "cutoff.breakfast", value: "09:00" },
    { key: "cutoff.lunch", value: "11:00" },
    { key: "cutoff.dinner", value: "17:00" },
    { key: "weeklyTemplate", value: JSON.stringify({ sundayClosed: true }) },
    { key: "jwtExpiryMinutes", value: "10080" },
    { key: "pinPolicyMinLength", value: "4" },
  ];

  for (const setting of settings) {
    await prisma.appSetting.upsert({
      where: { key: setting.key },
      create: {
        key: setting.key,
        value: setting.value,
        updatedById: idByEmployeeId.A1001 ?? null,
      },
      update: {
        value: setting.value,
        updatedById: idByEmployeeId.A1001 ?? null,
      },
    });
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowStr = formatLocalDate(tomorrow);

  await prisma.serviceDay.upsert({
    where: { date: tomorrowStr },
    create: {
      date: tomorrowStr,
      isOfficeOpen: true,
      breakfastServed: true,
      lunchServed: true,
      dinnerServed: false,
      updatedById: idByEmployeeId.A1001 ?? null,
      note: "Dinner not served (seed sample)",
    },
    update: {
      isOfficeOpen: true,
      breakfastServed: true,
      lunchServed: true,
      dinnerServed: false,
      updatedById: idByEmployeeId.A1001 ?? null,
      note: "Dinner not served (seed sample)",
    },
  });

  if (idByEmployeeId.E4001) {
    await prisma.mealRequest.upsert({
      where: {
        userId_date_mealType: {
          userId: idByEmployeeId.E4001,
          date: tomorrowStr,
          mealType: MealType.DINNER,
        },
      },
      create: {
        userId: idByEmployeeId.E4001,
        date: tomorrowStr,
        mealType: MealType.DINNER,
        status: "PENDING",
        note: "Requesting dinner for late shift",
      },
      update: {
        status: "PENDING",
        note: "Requesting dinner for late shift",
      },
    });
  }
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
