import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes refund metadata from payments only after the extracted table has
 * been verified to contain an exact copy of every legacy value.
 */
export class RemoveLegacyPaymentRefundColumns1784797000000 implements MigrationInterface {
  name = 'RemoveLegacyPaymentRefundColumns1784797000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await assertNoRows(
      queryRunner,
      refundDataMismatchQuery(),
      'Cannot remove legacy payment refund columns: extracted refund data is incomplete or different.',
    );

    await queryRunner.query(`
      ALTER TABLE payments
        DROP FOREIGN KEY fk_payments_refunded_by_user,
        DROP INDEX idx_payments_refunded_by_user,
        DROP INDEX idx_payments_status_refunded_at,
        DROP INDEX uq_payments_refund_request,
        DROP INDEX uq_payments_refund_idempotency,
        DROP COLUMN refund_last_queried_at,
        DROP COLUMN refund_requested_at,
        DROP COLUMN refunded_at,
        DROP COLUMN refunded_by_user_id,
        DROP COLUMN refund_reason,
        DROP COLUMN refund_message,
        DROP COLUMN refund_transaction_status,
        DROP COLUMN refund_response_code,
        DROP COLUMN refund_gateway_transaction_id,
        DROP COLUMN refund_previous_status,
        DROP COLUMN refund_request_id,
        DROP COLUMN refund_idempotency_key
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE payments
        ADD refund_idempotency_key varchar(100) NULL AFTER idempotency_key,
        ADD refund_request_id varchar(32) NULL AFTER refund_idempotency_key,
        ADD refund_previous_status varchar(30) NULL AFTER refund_request_id,
        ADD refund_gateway_transaction_id varchar(160) NULL AFTER refund_previous_status,
        ADD refund_response_code varchar(10) NULL AFTER refund_gateway_transaction_id,
        ADD refund_transaction_status varchar(10) NULL AFTER refund_response_code,
        ADD refund_message varchar(255) NULL AFTER refund_transaction_status,
        ADD refund_reason varchar(500) NULL AFTER refund_message,
        ADD refunded_by_user_id bigint NULL AFTER created_by_user_id,
        ADD refunded_at datetime(6) NULL AFTER paid_at,
        ADD refund_requested_at datetime(6) NULL AFTER refunded_at,
        ADD refund_last_queried_at datetime(6) NULL AFTER refund_requested_at,
        ADD UNIQUE KEY uq_payments_refund_idempotency (refund_idempotency_key),
        ADD UNIQUE KEY uq_payments_refund_request (refund_request_id),
        ADD KEY idx_payments_refunded_by_user (refunded_by_user_id),
        ADD KEY idx_payments_status_refunded_at (status, refunded_at),
        ADD CONSTRAINT fk_payments_refunded_by_user
          FOREIGN KEY (refunded_by_user_id) REFERENCES users (id)
          ON DELETE RESTRICT ON UPDATE RESTRICT
    `);

    await queryRunner.query(`
      UPDATE payments AS p
      INNER JOIN payment_refunds AS refund
        ON refund.payment_id = p.id
      SET
        p.refund_idempotency_key = refund.idempotency_key,
        p.refund_request_id = refund.request_id,
        p.refund_previous_status = refund.previous_payment_status,
        p.refund_gateway_transaction_id = refund.gateway_transaction_id,
        p.refund_response_code = refund.response_code,
        p.refund_transaction_status = refund.transaction_status,
        p.refund_message = refund.message,
        p.refund_reason = refund.reason,
        p.refunded_by_user_id = refund.refunded_by_user_id,
        p.refund_requested_at = refund.requested_at,
        p.refunded_at = refund.refunded_at,
        p.refund_last_queried_at = refund.last_queried_at
    `);

    await assertNoRows(
      queryRunner,
      refundDataMismatchQuery(),
      'Cannot rollback legacy payment refund columns: refund data could not be restored.',
    );
  }
}

function refundDataMismatchQuery(): string {
  return `
    SELECT p.id AS paymentId
    FROM payments AS p
    LEFT JOIN payment_refunds AS refund
      ON refund.payment_id = p.id
    WHERE (
      (
        p.status IN ('REFUND_PENDING', 'REFUNDED')
        OR p.refund_idempotency_key IS NOT NULL
        OR p.refund_request_id IS NOT NULL
        OR p.refund_previous_status IS NOT NULL
        OR p.refund_gateway_transaction_id IS NOT NULL
        OR p.refund_response_code IS NOT NULL
        OR p.refund_transaction_status IS NOT NULL
        OR p.refund_message IS NOT NULL
        OR p.refund_reason IS NOT NULL
        OR p.refunded_by_user_id IS NOT NULL
        OR p.refunded_at IS NOT NULL
        OR p.refund_requested_at IS NOT NULL
        OR p.refund_last_queried_at IS NOT NULL
      )
      AND refund.id IS NULL
    )
    OR (
      refund.id IS NOT NULL
      AND NOT (
        refund.idempotency_key <=> p.refund_idempotency_key
        AND refund.request_id <=> p.refund_request_id
        AND refund.previous_payment_status <=> p.refund_previous_status
        AND refund.gateway_transaction_id <=> p.refund_gateway_transaction_id
        AND refund.response_code <=> p.refund_response_code
        AND refund.transaction_status <=> p.refund_transaction_status
        AND refund.message <=> p.refund_message
        AND refund.reason <=> p.refund_reason
        AND refund.refunded_by_user_id <=> p.refunded_by_user_id
        AND refund.requested_at <=> p.refund_requested_at
        AND refund.refunded_at <=> p.refunded_at
        AND refund.last_queried_at <=> p.refund_last_queried_at
      )
    )
    LIMIT 1
  `;
}

async function assertNoRows(
  queryRunner: QueryRunner,
  sql: string,
  message: string,
): Promise<void> {
  const rows = (await queryRunner.query(sql)) as unknown[];

  if (rows.length > 0) {
    throw new Error(message);
  }
}
