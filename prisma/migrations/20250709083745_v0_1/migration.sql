/*
  Warnings:

  - You are about to drop the column `status` on the `user` table. All the data in the column will be lost.
  - You are about to drop the column `username` on the `user` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX `User_username_key` ON `user`;

-- AlterTable
ALTER TABLE `user` DROP COLUMN `status`,
    DROP COLUMN `username`,
    ADD COLUMN `phone` VARCHAR(191) NULL;
