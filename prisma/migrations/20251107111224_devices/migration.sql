/*
  Warnings:

  - A unique constraint covering the columns `[userId,deviceId]` on the table `refresh_tokens` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `deviceId` to the `refresh_tokens` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE `refresh_tokens` ADD COLUMN `deviceId` VARCHAR(191) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `refresh_tokens_userId_deviceId_key` ON `refresh_tokens`(`userId`, `deviceId`);
