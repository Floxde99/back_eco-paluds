-- AlterTable
ALTER TABLE `subscription` ADD COLUMN `billing_cycle` VARCHAR(191) NULL,
    ADD COLUMN `cancel_at_period_end` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `currency` VARCHAR(191) NOT NULL DEFAULT 'eur',
    ADD COLUMN `current_period_end` DATETIME(3) NULL,
    ADD COLUMN `current_period_start` DATETIME(3) NULL,
    ADD COLUMN `metadata` JSON NULL,
    ADD COLUMN `payment_method` VARCHAR(191) NULL,
    ADD COLUMN `plan_id` VARCHAR(191) NULL,
    ADD COLUMN `stripe_customer_id` VARCHAR(191) NULL;

-- AlterTable
ALTER TABLE `user` ADD COLUMN `stripe_customer_id` VARCHAR(191) NULL;
