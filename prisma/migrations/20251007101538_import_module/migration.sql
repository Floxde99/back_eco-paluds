-- CreateTable
CREATE TABLE `import_analyses` (
    `id_import_analysis` INTEGER NOT NULL AUTO_INCREMENT,
    `file_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `status` VARCHAR(50) NOT NULL DEFAULT 'PENDING',
    `predictions` JSON NULL,
    `partnerships` JSON NULL,
    `optimizations` JSON NULL,
    `financial_impact` JSON NULL,
    `precision_score` DECIMAL(5, 2) NULL,
    `processing_time_ms` INTEGER NULL,
    `rows_processed` INTEGER NULL,
    `errors` JSON NULL,
    `source_data` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id_import_analysis`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `import_files` (
    `id_import_file` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `file_name` VARCHAR(255) NOT NULL,
    `file_size` INTEGER NOT NULL,
    `file_type` VARCHAR(50) NOT NULL,
    `file_path` TEXT NOT NULL,
    `status` VARCHAR(50) NOT NULL DEFAULT 'UPLOADED',
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    PRIMARY KEY (`id_import_file`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `import_history` (
    `id_import_history` INTEGER NOT NULL AUTO_INCREMENT,
    `file_id` INTEGER NOT NULL,
    `analysis_id` INTEGER NULL,
    `user_id` INTEGER NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `status` VARCHAR(50) NOT NULL,
    `synced_to_profile` BOOLEAN NOT NULL DEFAULT false,
    `synced_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id_import_history`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `import_analyses` ADD CONSTRAINT `import_analyses_file_id_fkey` FOREIGN KEY (`file_id`) REFERENCES `import_files`(`id_import_file`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_analyses` ADD CONSTRAINT `import_analyses_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_files` ADD CONSTRAINT `import_files_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_history` ADD CONSTRAINT `import_history_file_id_fkey` FOREIGN KEY (`file_id`) REFERENCES `import_files`(`id_import_file`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_history` ADD CONSTRAINT `import_history_analysis_id_fkey` FOREIGN KEY (`analysis_id`) REFERENCES `import_analyses`(`id_import_analysis`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `import_history` ADD CONSTRAINT `import_history_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;
