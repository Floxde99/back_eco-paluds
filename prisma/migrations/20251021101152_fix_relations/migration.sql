/*
  Warnings:

  - You are about to drop the `partners` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `transports` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE `transports` DROP FOREIGN KEY `transports_partner_id_fkey`;

-- DropTable
DROP TABLE `partners`;

-- DropTable
DROP TABLE `transports`;
