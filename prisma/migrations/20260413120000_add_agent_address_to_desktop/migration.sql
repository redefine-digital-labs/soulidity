-- AlterTable
ALTER TABLE "desktop_device_sessions" ADD COLUMN "agent_address" TEXT;

-- AlterTable
ALTER TABLE "desktop_profiles" ADD COLUMN "agent_address" TEXT;
