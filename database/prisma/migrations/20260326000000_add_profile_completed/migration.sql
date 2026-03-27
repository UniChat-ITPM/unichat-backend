-- AlterTable: add profileCompleted column (backward-compatible, defaults to false)
ALTER TABLE "User" ADD COLUMN "profileCompleted" BOOLEAN NOT NULL DEFAULT false;

-- Mark existing users who already have username + email as completed
UPDATE "User"
SET "profileCompleted" = true
WHERE "username" IS NOT NULL
  AND "email" IS NOT NULL;
