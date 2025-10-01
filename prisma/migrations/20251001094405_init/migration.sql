-- CreateTable
CREATE TABLE `companies` (
    `id_company` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `siret` VARCHAR(191) NOT NULL,
    `sector` VARCHAR(191) NOT NULL,
    `address` VARCHAR(191) NOT NULL,
    `latitude` DOUBLE NOT NULL,
    `longitude` DOUBLE NOT NULL,
    `phone` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `website` VARCHAR(191) NULL,
    `description` VARCHAR(191) NULL,
    `validation_status` VARCHAR(191) NOT NULL,
    `creation_date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_update` DATETIME(3) NOT NULL,
    `owner_id` INTEGER NULL,

    UNIQUE INDEX `companies_siret_key`(`siret`),
    PRIMARY KEY (`id_company`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `company_types` (
    `company_id` INTEGER NOT NULL,
    `type_id` INTEGER NOT NULL,

    PRIMARY KEY (`company_id`, `type_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `families` (
    `id_family` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id_family`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `flows` (
    `input_id` INTEGER NOT NULL,
    `output_id` INTEGER NOT NULL,

    PRIMARY KEY (`input_id`, `output_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `inputs` (
    `id_input` INTEGER NOT NULL AUTO_INCREMENT,
    `resource_id` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `unit_measure` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL,
    `creation_date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_update` DATETIME(3) NOT NULL,
    `company_id` INTEGER NOT NULL,
    `family_id` INTEGER NULL,

    PRIMARY KEY (`id_input`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `outputs` (
    `id_output` INTEGER NOT NULL AUTO_INCREMENT,
    `resource_id` VARCHAR(191) NULL,
    `name` VARCHAR(191) NOT NULL,
    `category` VARCHAR(191) NOT NULL,
    `is_been` BOOLEAN NOT NULL,
    `unit_measure` VARCHAR(191) NOT NULL,
    `description` VARCHAR(191) NULL,
    `status` VARCHAR(191) NOT NULL,
    `creation_date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_update` DATETIME(3) NOT NULL,
    `company_id` INTEGER NOT NULL,
    `family_id` INTEGER NULL,

    PRIMARY KEY (`id_output`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `partners` (
    `partner_id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,
    `service_type` VARCHAR(191) NOT NULL,
    `coverage_area` VARCHAR(191) NOT NULL,
    `capacity` INTEGER NOT NULL,
    `rate` DOUBLE NOT NULL,
    `contact` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`partner_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id_role` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id_role`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `subscriptions` (
    `id_subscription` INTEGER NOT NULL AUTO_INCREMENT,
    `stripe_id` VARCHAR(191) NOT NULL,
    `stripe_customer_id` VARCHAR(191) NULL,
    `subscription_type` VARCHAR(191) NOT NULL,
    `plan_id` VARCHAR(191) NULL,
    `billing_cycle` VARCHAR(191) NULL,
    `start_date` DATETIME(3) NOT NULL,
    `end_date` DATETIME(3) NULL,
    `current_period_start` DATETIME(3) NULL,
    `current_period_end` DATETIME(3) NULL,
    `cancel_at_period_end` BOOLEAN NOT NULL DEFAULT false,
    `price` DOUBLE NOT NULL,
    `currency` VARCHAR(191) NOT NULL DEFAULT 'eur',
    `status` VARCHAR(191) NOT NULL,
    `ai_consumption` INTEGER NOT NULL DEFAULT 0,
    `billing_threshold` DOUBLE NOT NULL,
    `payment_method` VARCHAR(191) NULL,
    `metadata` JSON NULL,
    `user_id` INTEGER NOT NULL,

    UNIQUE INDEX `subscriptions_stripe_id_key`(`stripe_id`),
    PRIMARY KEY (`id_subscription`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `refresh_tokens` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `token` VARCHAR(191) NOT NULL,
    `userId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `refresh_tokens_token_key`(`token`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `transports` (
    `transport_id` INTEGER NOT NULL AUTO_INCREMENT,
    `collection_date` DATETIME(3) NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `cost` DOUBLE NOT NULL,
    `distance` DOUBLE NOT NULL,
    `comments` VARCHAR(191) NULL,
    `partner_id` INTEGER NOT NULL,

    PRIMARY KEY (`transport_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `types` (
    `id_type` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id_type`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `users` (
    `id_user` INTEGER NOT NULL AUTO_INCREMENT,
    `first_name` VARCHAR(191) NOT NULL,
    `last_name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `avatar_url` VARCHAR(191) NULL,
    `stripe_customer_id` VARCHAR(191) NULL,
    `confirmEmail` BOOLEAN NOT NULL DEFAULT false,
    `roleId` INTEGER NULL,
    `creation_date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_connection` DATETIME(3) NULL,

    UNIQUE INDEX `users_email_key`(`email`),
    PRIMARY KEY (`id_user`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `companies` ADD CONSTRAINT `companies_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `users`(`id_user`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_types` ADD CONSTRAINT `company_types_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id_company`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_types` ADD CONSTRAINT `company_types_type_id_fkey` FOREIGN KEY (`type_id`) REFERENCES `types`(`id_type`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `flows` ADD CONSTRAINT `flows_input_id_fkey` FOREIGN KEY (`input_id`) REFERENCES `inputs`(`id_input`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `flows` ADD CONSTRAINT `flows_output_id_fkey` FOREIGN KEY (`output_id`) REFERENCES `outputs`(`id_output`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inputs` ADD CONSTRAINT `inputs_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id_company`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `inputs` ADD CONSTRAINT `inputs_family_id_fkey` FOREIGN KEY (`family_id`) REFERENCES `families`(`id_family`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `outputs` ADD CONSTRAINT `outputs_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id_company`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `outputs` ADD CONSTRAINT `outputs_family_id_fkey` FOREIGN KEY (`family_id`) REFERENCES `families`(`id_family`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `subscriptions` ADD CONSTRAINT `subscriptions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `refresh_tokens` ADD CONSTRAINT `refresh_tokens_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `transports` ADD CONSTRAINT `transports_partner_id_fkey` FOREIGN KEY (`partner_id`) REFERENCES `partners`(`partner_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `users` ADD CONSTRAINT `users_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `roles`(`id_role`) ON DELETE SET NULL ON UPDATE CASCADE;
