-- CreateTable
CREATE TABLE `suggestion_interactions` (
    `id_suggestion` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `target_company_id` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'new',
    `last_score` INTEGER NULL,
    `distance_km` DOUBLE NULL,
    `reasons` JSON NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `suggestion_interactions_user_id_target_company_id_key`(`user_id`, `target_company_id`),
    PRIMARY KEY (`id_suggestion`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `suggestion_interactions` ADD CONSTRAINT `suggestion_interactions_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `suggestion_interactions` ADD CONSTRAINT `suggestion_interactions_target_company_id_fkey` FOREIGN KEY (`target_company_id`) REFERENCES `companies`(`id_company`) ON DELETE RESTRICT ON UPDATE CASCADE;
