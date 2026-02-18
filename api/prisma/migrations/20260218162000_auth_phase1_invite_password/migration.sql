-- AlterTable
ALTER TABLE "User" ADD COLUMN "email" TEXT;
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "User" ADD COLUMN "phone" TEXT;
ALTER TABLE "User" ADD COLUMN "authProvider" TEXT;

-- CreateTable
CREATE TABLE "UserInvite" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "dept" TEXT,
    "site" TEXT,
    "supervisorEmployeeId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "usedAt" DATETIME,
    "createdByUserId" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UserInvite_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "UserInvite_email_key" ON "UserInvite"("email");
CREATE INDEX "UserInvite_tokenHash_idx" ON "UserInvite"("tokenHash");
CREATE INDEX "UserInvite_expiresAt_idx" ON "UserInvite"("expiresAt");
CREATE INDEX "UserInvite_usedAt_idx" ON "UserInvite"("usedAt");
CREATE INDEX "UserInvite_createdAt_idx" ON "UserInvite"("createdAt");
