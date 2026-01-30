/*
  Warnings:

  - You are about to drop the column `company` on the `Visitor` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Visitor" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "purpose" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    "createdById" TEXT,
    CONSTRAINT "Visitor_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Visitor" ("createdAt", "createdById", "id", "name", "phone", "purpose", "updatedAt")
SELECT "createdAt", "createdById", "id", "name", "phone", "company", "updatedAt" FROM "Visitor";
DROP TABLE "Visitor";
ALTER TABLE "new_Visitor" RENAME TO "Visitor";
CREATE UNIQUE INDEX "Visitor_phone_key" ON "Visitor"("phone");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
