-- CreateTable
CREATE TABLE `assistant_conversations` (
    `id_assistant_conversation` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `title` VARCHAR(255) NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'OPEN',
    `last_event_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `assistant_conversations_user_id_last_event_at_idx`(`user_id`, `last_event_at`),
    PRIMARY KEY (`id_assistant_conversation`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assistant_escalations` (
    `id_assistant_escalation` INTEGER NOT NULL AUTO_INCREMENT,
    `conversation_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'PENDING',
    `subject` VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `transcript` JSON NULL,
    `ticket_reference` VARCHAR(255) NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `assistant_escalations_conversation_id_created_at_idx`(`conversation_id`, `created_at`),
    PRIMARY KEY (`id_assistant_escalation`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assistant_messages` (
    `id_assistant_message` INTEGER NOT NULL AUTO_INCREMENT,
    `conversation_id` INTEGER NOT NULL,
    `user_id` INTEGER NULL,
    `role` VARCHAR(30) NOT NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'QUEUED',
    `text` TEXT NULL,
    `content` JSON NULL,
    `tokens_in` INTEGER NULL DEFAULT 0,
    `tokens_out` INTEGER NULL DEFAULT 0,
    `error` TEXT NULL,
    `metadata` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `assistant_messages_conversation_id_created_at_idx`(`conversation_id`, `created_at`),
    PRIMARY KEY (`id_assistant_message`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `assistant_telemetry` (
    `id_assistant_telemetry` INTEGER NOT NULL AUTO_INCREMENT,
    `conversation_id` INTEGER NOT NULL,
    `message_id` INTEGER NULL,
    `user_id` INTEGER NOT NULL,
    `event_type` VARCHAR(50) NOT NULL,
    `label` VARCHAR(255) NULL,
    `data` JSON NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `assistant_telemetry_conversation_id_created_at_idx`(`conversation_id`, `created_at`),
    PRIMARY KEY (`id_assistant_telemetry`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `assistant_conversations` ADD CONSTRAINT `assistant_conversations_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assistant_escalations` ADD CONSTRAINT `assistant_escalations_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `assistant_conversations`(`id_assistant_conversation`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assistant_escalations` ADD CONSTRAINT `assistant_escalations_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assistant_messages` ADD CONSTRAINT `assistant_messages_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `assistant_conversations`(`id_assistant_conversation`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assistant_messages` ADD CONSTRAINT `assistant_messages_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id_user`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assistant_telemetry` ADD CONSTRAINT `assistant_telemetry_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `assistant_conversations`(`id_assistant_conversation`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assistant_telemetry` ADD CONSTRAINT `assistant_telemetry_message_id_fkey` FOREIGN KEY (`message_id`) REFERENCES `assistant_messages`(`id_assistant_message`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `assistant_telemetry` ADD CONSTRAINT `assistant_telemetry_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;
