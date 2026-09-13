import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Indexes used by paginated inbox filters and per-actor unread aggregates. */
export class AddChatInboxQueryIndexes1784801100000 implements MigrationInterface {
  name = 'AddChatInboxQueryIndexes1784801100000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE chat_conversations
        ADD KEY idx_chat_conversations_last_actor_message_at
          (last_message_actor_type, last_message_at)
    `);
    await queryRunner.query(`
      ALTER TABLE chat_messages
        ADD KEY idx_chat_messages_sender_conversation_sequence
          (sender_actor_type, conversation_id, sequence)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE chat_messages
        DROP KEY idx_chat_messages_sender_conversation_sequence
    `);
    await queryRunner.query(`
      ALTER TABLE chat_conversations
        DROP KEY idx_chat_conversations_last_actor_message_at
    `);
  }
}
