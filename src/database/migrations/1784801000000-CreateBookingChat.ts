import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persisted booking support chat. Conversations are deliberately not created
 * for existing bookings; the first committed message creates its conversation.
 */
export class CreateBookingChat1784801000000 implements MigrationInterface {
  name = 'CreateBookingChat1784801000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE chat_conversations (
        id bigint NOT NULL AUTO_INCREMENT,
        booking_id bigint NOT NULL,
        last_sequence int NOT NULL DEFAULT 0,
        last_message_content varchar(2000) NULL,
        last_message_actor_type varchar(16) NULL,
        last_message_actor_id bigint NULL,
        last_message_at datetime(6) NULL,
        created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY uq_chat_conversations_booking (booking_id),
        KEY idx_chat_conversations_last_message_at (last_message_at),
        CONSTRAINT chat_conversations_ibfk_1
          FOREIGN KEY (booking_id) REFERENCES bookings (id)
          ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT chk_chat_conversations_last_sequence CHECK (last_sequence >= 0),
        CONSTRAINT chk_chat_conversations_last_message_actor_type
          CHECK (
            last_message_actor_type IS NULL
            OR last_message_actor_type IN ('customer', 'user')
          )
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await queryRunner.query(`
      CREATE TABLE chat_messages (
        id bigint NOT NULL AUTO_INCREMENT,
        conversation_id bigint NOT NULL,
        sequence int NOT NULL,
        sender_actor_type varchar(16) NOT NULL,
        sender_actor_id bigint NOT NULL,
        content varchar(2000) NOT NULL,
        client_message_id varchar(100) NOT NULL,
        created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY uq_chat_messages_conversation_sequence (conversation_id, sequence),
        UNIQUE KEY uq_chat_messages_sender_client_message
          (conversation_id, sender_actor_type, sender_actor_id, client_message_id),
        KEY idx_chat_messages_conversation_sequence (conversation_id, sequence),
        CONSTRAINT chat_messages_ibfk_1
          FOREIGN KEY (conversation_id) REFERENCES chat_conversations (id)
          ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT chk_chat_messages_sequence CHECK (sequence > 0),
        CONSTRAINT chk_chat_messages_sender_actor_type
          CHECK (sender_actor_type IN ('customer', 'user'))
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await queryRunner.query(`
      CREATE TABLE chat_read_states (
        id bigint NOT NULL AUTO_INCREMENT,
        conversation_id bigint NOT NULL,
        actor_type varchar(16) NOT NULL,
        actor_id bigint NOT NULL,
        last_read_sequence int NOT NULL DEFAULT 0,
        updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY uq_chat_read_states_conversation_actor
          (conversation_id, actor_type, actor_id),
        KEY idx_chat_read_states_actor (actor_type, actor_id),
        CONSTRAINT chat_read_states_ibfk_1
          FOREIGN KEY (conversation_id) REFERENCES chat_conversations (id)
          ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT chk_chat_read_states_last_sequence CHECK (last_read_sequence >= 0),
        CONSTRAINT chk_chat_read_states_actor_type
          CHECK (actor_type IN ('customer', 'user'))
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE chat_read_states');
    await queryRunner.query('DROP TABLE chat_messages');
    await queryRunner.query('DROP TABLE chat_conversations');
  }
}
