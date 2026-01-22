-- CreateTable
CREATE TABLE "ServiceDay" (
    "date" TEXT NOT NULL PRIMARY KEY,
    "isOfficeOpen" BOOLEAN NOT NULL DEFAULT true,
    "breakfastServed" BOOLEAN NOT NULL DEFAULT true,
    "lunchServed" BOOLEAN NOT NULL DEFAULT true,
    "dinnerServed" BOOLEAN NOT NULL DEFAULT true,
    "breakfastCutoff" TEXT,
    "lunchCutoff" TEXT,
    "dinnerCutoff" TEXT,
    "note" TEXT,
    "updatedAt" DATETIME NOT NULL,
    "updatedById" TEXT,
    CONSTRAINT "ServiceDay_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
