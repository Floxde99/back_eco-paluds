-- CreateTable
CREATE TABLE `company_contacts` (
    `id_company_contact` INTEGER NOT NULL AUTO_INCREMENT,
    `user_id` INTEGER NOT NULL,
    `company_id` INTEGER NOT NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'active',
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `company_contacts_user_id_company_id_key`(`user_id`, `company_id`),
    PRIMARY KEY (`id_company_contact`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `company_conversations` (
    `id_company_conversation` INTEGER NOT NULL AUTO_INCREMENT,
    `contact_id` INTEGER NOT NULL,
    `user_id` INTEGER NOT NULL,
    `company_id` INTEGER NOT NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'active',
    `last_message_at` DATETIME(3) NULL,
    `last_message_preview` VARCHAR(255) NULL,
    `unread_count` INTEGER NOT NULL DEFAULT 0,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    UNIQUE INDEX `company_conversations_user_id_company_id_key`(`user_id`, `company_id`),
    PRIMARY KEY (`id_company_conversation`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `company_messages` (
    `id_company_message` INTEGER NOT NULL AUTO_INCREMENT,
    `conversation_id` INTEGER NOT NULL,
    `company_id` INTEGER NOT NULL,
    `sender_id` INTEGER NOT NULL,
    `recipient_id` INTEGER NULL,
    `body` TEXT NOT NULL,
    `attachments` JSON NULL,
    `status` VARCHAR(30) NOT NULL DEFAULT 'sent',
    `trace_id` VARCHAR(64) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updated_at` DATETIME(3) NOT NULL,

    INDEX `company_messages_conversation_id_created_at_idx`(`conversation_id`, `created_at`),
    PRIMARY KEY (`id_company_message`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `company_contacts` ADD CONSTRAINT `company_contacts_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_contacts` ADD CONSTRAINT `company_contacts_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id_company`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_conversations` ADD CONSTRAINT `company_conversations_contact_id_fkey` FOREIGN KEY (`contact_id`) REFERENCES `company_contacts`(`id_company_contact`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_conversations` ADD CONSTRAINT `company_conversations_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_conversations` ADD CONSTRAINT `company_conversations_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id_company`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_messages` ADD CONSTRAINT `company_messages_conversation_id_fkey` FOREIGN KEY (`conversation_id`) REFERENCES `company_conversations`(`id_company_conversation`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_messages` ADD CONSTRAINT `company_messages_company_id_fkey` FOREIGN KEY (`company_id`) REFERENCES `companies`(`id_company`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_messages` ADD CONSTRAINT `company_messages_sender_id_fkey` FOREIGN KEY (`sender_id`) REFERENCES `users`(`id_user`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `company_messages` ADD CONSTRAINT `company_messages_recipient_id_fkey` FOREIGN KEY (`recipient_id`) REFERENCES `users`(`id_user`) ON DELETE SET NULL ON UPDATE CASCADE;
