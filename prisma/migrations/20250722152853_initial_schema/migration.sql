-- CreateTable
CREATE TABLE `User` (
    `id_user` INTEGER NOT NULL AUTO_INCREMENT,
    `first_name` VARCHAR(191) NOT NULL,
    `last_name` VARCHAR(191) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `phone` VARCHAR(191) NULL,
    `role` VARCHAR(191) NOT NULL,
    `creation_date` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `last_connection` DATETIME(3) NULL,

    UNIQUE INDEX `User_email_key`(`email`),
    PRIMARY KEY (`id_user`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Company` (
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

    UNIQUE INDEX `Company_siret_key`(`siret`),
    PRIMARY KEY (`id_company`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompanyType` (
    `company_id` INTEGER NOT NULL,
    `type_id` INTEGER NOT NULL,

    PRIMARY KEY (`company_id`, `type_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Type` (
    `id_type` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id_type`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Family` (
    `id_family` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id_family`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Input` (
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
CREATE TABLE `Output` (
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
CREATE TABLE `Flow` (
    `input_id` INTEGER NOT NULL,
    `output_id` INTEGER NOT NULL,

    PRIMARY KEY (`input_id`, `output_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Partner` (
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
CREATE TABLE `Transport` (
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
CREATE TABLE `Role` (
    `id_role` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,

    PRIMARY KEY (`id_role`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Subscription` (
    `id_subscription` INTEGER NOT NULL AUTO_INCREMENT,
    `stripe_id` VARCHAR(191) NOT NULL,
    `subscription_type` VARCHAR(191) NOT NULL,
    `start_date` DATETIME(3) NOT NULL,
    `end_date` DATETIME(3) NULL,
    `price` DOUBLE NOT NULL,
    `status` VARCHAR(191) NOT NULL,
    `ai_consumption` INTEGER NOT NULL DEFAULT 0,
    `billing_threshold` DOUBLE NOT NULL,
    `user_id` INTEGER NOT NULL,

    UNIQUE INDEX `Subscription_stripe_id_key`(`stripe_id`),
    PRIMARY KEY (`id_subscription`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `Company` ADD CONSTRAINT `Company_owner_id_fkey` FOREIGN KEY (`owner_id`) REFERENCES `User`(`id_user`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompanyType` ADD CONSTRAINT `CompanyType_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `Company`(`id_company`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `CompanyType` ADD CONSTRAINT `CompanyType_type_id_fkey` FOREIGN KEY (`type_id`) REFERENCES `Type`(`id_type`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Input` ADD CONSTRAINT `Input_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `Company`(`id_company`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Input` ADD CONSTRAINT `Input_family_id_fkey` FOREIGN KEY (`family_id`) REFERENCES `Family`(`id_family`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Output` ADD CONSTRAINT `Output_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `Company`(`id_company`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Output` ADD CONSTRAINT `Output_family_id_fkey` FOREIGN KEY (`family_id`) REFERENCES `Family`(`id_family`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Flow` ADD CONSTRAINT `Flow_input_id_fkey` FOREIGN KEY (`input_id`) REFERENCES `Input`(`id_input`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Flow` ADD CONSTRAINT `Flow_output_id_fkey` FOREIGN KEY (`output_id`) REFERENCES `Output`(`id_output`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Transport` ADD CONSTRAINT `Transport_partner_id_fkey` FOREIGN KEY (`partner_id`) REFERENCES `Partner`(`partner_id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `User`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;
