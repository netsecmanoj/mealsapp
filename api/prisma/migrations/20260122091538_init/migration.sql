-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "employeeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dept" TEXT,
    "role" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "MealChoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" DATETIME NOT NULL,
    "mealType" TEXT NOT NULL,
    "wantMeal" BOOLEAN NOT NULL,
    "source" TEXT NOT NULL,
    "updatedAt" DATETIME NOT NULL,
    "userId" TEXT NOT NULL,
    "updatedById" TEXT,
    CONSTRAINT "MealChoice_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MealChoice_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_employeeId_key" ON "User"("employeeId");

-- CreateIndex
CREATE INDEX "MealChoice_date_mealType_idx" ON "MealChoice"("date", "mealType");

-- CreateIndex
CREATE UNIQUE INDEX "MealChoice_userId_date_mealType_key" ON "MealChoice"("userId", "date", "mealType");
