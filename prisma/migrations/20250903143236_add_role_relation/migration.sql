/*
  Warnings:

  - You are about to drop the column `role` on the `user` table. All the data in the column will be lost.

*/
-- AlterTable
-- Keep the legacy `role` column for now. We'll populate `roleId` from `role` before dropping it.
ALTER TABLE `user`
  ADD COLUMN `confirmEmail` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `roleId` INTEGER NULL;

-- AddForeignKey
ALTER TABLE `User` ADD CONSTRAINT `User_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role`(`id_role`) ON DELETE SET NULL ON UPDATE CASCADE;
