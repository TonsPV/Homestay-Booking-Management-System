import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAuditLogs1784787000000 implements MigrationInterface {
  name = 'CreateAuditLogs1784787000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE audit_logs (
        id bigint NOT NULL AUTO_INCREMENT,
        actor_type enum('CUSTOMER','USER','SYSTEM') NOT NULL,
        actor_id bigint NULL,
        action enum(
          'BOOKING_CREATED',
          'BOOKING_STATUS_CHANGED',
          'BOOKING_CANCELLED',
          'ROOM_STATUS_CHANGED',
          'PAYMENT_CONFIRMED',
          'REFUND_REQUESTED',
          'REFUND_COMPLETED',
          'ACCOUNT_LOCKED',
          'ACCOUNT_UNLOCKED'
        ) NOT NULL,
        entity_type enum('BOOKING','ROOM','PAYMENT','CUSTOMER') NOT NULL,
        entity_id varchar(64) NOT NULL,
        request_id varchar(200) NULL,
        metadata json NULL,
        created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        INDEX idx_audit_logs_action_created (action, created_at),
        INDEX idx_audit_logs_entity_created
          (entity_type, entity_id, created_at),
        INDEX idx_audit_logs_actor_created
          (actor_type, actor_id, created_at),
        INDEX idx_audit_logs_request_id (request_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE audit_logs');
  }
}
