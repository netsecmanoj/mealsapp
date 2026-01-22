import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient, Role } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const pinHash = await bcrypt.hash("1234", 10);

  const users = [
    {
      employeeId: "A1001",
      name: "Admin User",
      role: Role.ADMIN,
      dept: "IT",
    },
    {
      employeeId: "S2001",
      name: "Supervisor One",
      role: Role.SUPERVISOR,
      dept: "Facilities",
    },
    {
      employeeId: "E3001",
      name: "Employee One",
      role: Role.EMPLOYEE,
      dept: "Operations",
    },
  ];

  for (const user of users) {
    await prisma.user.upsert({
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
