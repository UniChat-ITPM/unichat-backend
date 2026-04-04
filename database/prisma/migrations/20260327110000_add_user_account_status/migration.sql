-- AlterTable: add accountStatus column (soft deactivation support)
ALTER TABLE "User"
ADD COLUMN "accountStatus" BOOLEAN NOT NULL DEFAULT true;
