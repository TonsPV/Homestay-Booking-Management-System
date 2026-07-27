import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVnpayRefundManagement1784778000000 implements MigrationInterface {
  name = 'AddVnpayRefundManagement1784778000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE payments
        MODIFY status enum(
          'PENDING',
          'SUCCESS',
          'FAILED',
          'REQUIRES_REVIEW',
          'REFUND_PENDING',
          'REFUNDED'
        ) NOT NULL DEFAULT 'PENDING',
        ADD gateway_transaction_date char(14) NULL
          AFTER gateway_transaction_status,
        ADD refund_idempotency_key varchar(100) NULL
          AFTER idempotency_key,
        ADD refund_request_id varchar(32) NULL
          AFTER refund_idempotency_key,
        ADD refund_previous_status varchar(30) NULL
          AFTER refund_request_id,
        ADD refund_gateway_transaction_id varchar(160) NULL
          AFTER refund_previous_status,
        ADD refund_response_code varchar(10) NULL
          AFTER refund_gateway_transaction_id,
        ADD refund_transaction_status varchar(10) NULL
          AFTER refund_response_code,
        ADD refund_message varchar(255) NULL
          AFTER refund_transaction_status,
        ADD refund_reason varchar(500) NULL
          AFTER refund_message,
        ADD refund_requested_at datetime(6) NULL
          AFTER refunded_at,
        ADD refund_last_queried_at datetime(6) NULL
          AFTER refund_requested_at,
        ADD UNIQUE KEY uq_payments_refund_idempotency (
          refund_idempotency_key
        ),
        ADD UNIQUE KEY uq_payments_refund_request (refund_request_id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE payments
      SET status = COALESCE(refund_previous_status, 'REQUIRES_REVIEW')
      WHERE status = 'REFUND_PENDING'
    `);

    await queryRunner.query(`
      ALTER TABLE payments
        DROP INDEX uq_payments_refund_request,
        DROP INDEX uq_payments_refund_idempotency,
        DROP COLUMN refund_last_queried_at,
        DROP COLUMN refund_requested_at,
        DROP COLUMN refund_reason,
        DROP COLUMN refund_message,
        DROP COLUMN refund_transaction_status,
        DROP COLUMN refund_response_code,
        DROP COLUMN refund_gateway_transaction_id,
        DROP COLUMN refund_previous_status,
        DROP COLUMN refund_request_id,
        DROP COLUMN refund_idempotency_key,
        DROP COLUMN gateway_transaction_date,
        MODIFY status enum(
          'PENDING',
          'SUCCESS',
          'FAILED',
          'REQUIRES_REVIEW',
          'REFUNDED'
        ) NOT NULL DEFAULT 'PENDING'
    `);
  }
}
