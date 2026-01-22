import "dotenv/config";
import bcrypt from "bcryptjs";
import { MealType, PrismaClient, Role } from "@prisma/client";

const prisma = new PrismaClient();

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
