/*
  Warnings:

  - You are about to drop the `login_challenges` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "login_challenges" DROP CONSTRAINT "login_challenges_member_id_fkey";

-- DropTable
DROP TABLE "login_challenges";
