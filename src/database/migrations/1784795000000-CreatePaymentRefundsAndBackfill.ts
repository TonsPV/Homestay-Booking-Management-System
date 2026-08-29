import type { MigrationInterface, QueryRunner } from 'typeorm';

const refundCandidate = `
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
`;

/**
 * Creates the one-to-one refund operation table and copies the legacy refund
 * metadata before any legacy payment columns are removed.
 */
export class CreatePaymentRefundsAndBackfill1784795000000 implements MigrationInterface {
  name = 'CreatePaymentRefundsAndBackfill1784795000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await assertNoRows(
      queryRunner,
      `
        SELECT booking.id AS bookingId, booking.accepted_payment_id AS acceptedPaymentId,
               payment.id AS paymentId
        FROM bookings AS booking
        LEFT JOIN payments AS payment
          ON payment.id = booking.accepted_payment_id
        WHERE booking.accepted_payment_id IS NOT NULL
          AND payment.id IS NULL
        LIMIT 1
      `,
      'Cannot create payment refunds: a booking points to a missing accepted payment.',
    );

    await assertNoRows(
      queryRunner,
      `
        SELECT booking.id AS bookingId, booking.accepted_payment_id AS acceptedPaymentId,
               payment.booking_id AS paymentBookingId
        FROM bookings AS booking
        INNER JOIN payments AS payment
          ON payment.id = booking.accepted_payment_id
        WHERE booking.accepted_payment_id IS NOT NULL
          AND payment.booking_id <> booking.id
        LIMIT 1
      `,
      'Cannot create payment refunds: an accepted payment belongs to another booking.',
    );

    await assertNoRows(
      queryRunner,
      `
        SELECT refund_idempotency_key AS idempotencyKey, COUNT(*) AS rowCount
        FROM payments
        WHERE refund_idempotency_key IS NOT NULL
        GROUP BY refund_idempotency_key
        HAVING COUNT(*) > 1
        LIMIT 1
      `,
      'Cannot create payment refunds: duplicate legacy refund idempotency keys exist.',
    );

    await assertNoRows(
      queryRunner,
      `
        SELECT refund_request_id AS requestId, COUNT(*) AS rowCount
        FROM payments
        WHERE refund_request_id IS NOT NULL
        GROUP BY refund_request_id
        HAVING COUNT(*) > 1
        LIMIT 1
      `,
      'Cannot create payment refunds: duplicate legacy refund request ids exist.',
    );

    await assertNoRows(
      queryRunner,
      `
        SELECT id, status
        FROM payments AS p
        WHERE p.status = 'REFUND_PENDING'
          AND (
            p.refund_idempotency_key IS NULL
            OR p.refund_request_id IS NULL
            OR p.refund_previous_status IS NULL
            OR p.refund_requested_at IS NULL
          )
        LIMIT 1
      `,
      'Cannot create payment refunds: a pending refund is missing operation metadata.',
    );

    await assertNoRows(
      queryRunner,
      `
        SELECT id, method
        FROM payments AS p
        WHERE p.status = 'REFUNDED'
          AND (
            p.refunded_at IS NULL
            OR (
              p.method = 'VNPAY'
              AND (
                p.refund_gateway_transaction_id IS NULL
                OR p.refund_response_code IS NULL
                OR p.refund_transaction_status IS NULL
              )
            )
          )
        LIMIT 1
      `,
      'Cannot create payment refunds: a refunded payment is missing completion evidence.',
    );

    await assertNoRows(
      queryRunner,
      `
        SELECT p.id AS paymentId, p.refunded_by_user_id AS userId
        FROM payments AS p
        LEFT JOIN users AS u ON u.id = p.refunded_by_user_id
        WHERE p.refunded_by_user_id IS NOT NULL
          AND u.id IS NULL
        LIMIT 1
      `,
      'Cannot create payment refunds: a refund actor does not exist.',
    );

    await assertNoRows(
      queryRunner,
      `
        SELECT id, refund_previous_status AS previousStatus
        FROM payments AS p
        WHERE p.refund_previous_status IS NOT NULL
          AND p.refund_previous_status NOT IN (
            'PENDING', 'SUCCESS', 'FAILED', 'REQUIRES_REVIEW',
            'REFUND_PENDING', 'REFUNDED'
          )
        LIMIT 1
      `,
      'Cannot create payment refunds: a legacy previous payment status is invalid.',
    );

    await assertNoRows(
      queryRunner,
      `
        SELECT id
        FROM payments AS p
        WHERE (
          p.refunded_at IS NOT NULL
          AND p.refund_requested_at IS NOT NULL
          AND p.refunded_at < p.refund_requested_at
        )
        OR (
          p.refund_last_queried_at IS NOT NULL
          AND p.refund_requested_at IS NOT NULL
          AND p.refund_last_queried_at < p.refund_requested_at
        )
        LIMIT 1
      `,
      'Cannot create payment refunds: refund timestamps are inconsistent.',
    );

    await queryRunner.query(`
      CREATE TABLE payment_refunds (
        id bigint NOT NULL AUTO_INCREMENT,
        payment_id bigint NOT NULL,
        idempotency_key varchar(100) NULL,
        request_id varchar(32) NULL,
        previous_payment_status varchar(30) NULL,
        gateway_transaction_id varchar(160) NULL,
        response_code varchar(10) NULL,
        transaction_status varchar(10) NULL,
        message varchar(255) NULL,
        reason varchar(500) NULL,
        refunded_by_user_id bigint NULL,
        requested_at datetime(6) NULL,
        refunded_at datetime(6) NULL,
        last_queried_at datetime(6) NULL,
        created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at datetime(6) NOT NULL
          DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY uq_payment_refunds_payment (payment_id),
        UNIQUE KEY uq_payment_refunds_idempotency (idempotency_key),
        UNIQUE KEY uq_payment_refunds_request (request_id),
        KEY idx_payment_refunds_refunded_by_user (refunded_by_user_id),
        KEY idx_payment_refunds_requested_at (requested_at),
        CONSTRAINT fk_payment_refunds_payment
          FOREIGN KEY (payment_id) REFERENCES payments (id)
          ON DELETE RESTRICT ON UPDATE RESTRICT,
        CONSTRAINT fk_payment_refunds_refunded_by_user
          FOREIGN KEY (refunded_by_user_id) REFERENCES users (id)
          ON DELETE RESTRICT ON UPDATE RESTRICT
      ) ENGINE = InnoDB
        DEFAULT CHARACTER SET utf8mb4
        COLLATE utf8mb4_0900_ai_ci
    `);

    await queryRunner.query(`
      INSERT INTO payment_refunds (
        payment_id,
        idempotency_key,
        request_id,
        previous_payment_status,
        gateway_transaction_id,
        response_code,
        transaction_status,
        message,
        reason,
        refunded_by_user_id,
        requested_at,
        refunded_at,
        last_queried_at
      )
      SELECT
        p.id,
        p.refund_idempotency_key,
        p.refund_request_id,
        p.refund_previous_status,
        p.refund_gateway_transaction_id,
        p.refund_response_code,
        p.refund_transaction_status,
        p.refund_message,
        p.refund_reason,
        p.refunded_by_user_id,
        p.refund_requested_at,
        p.refunded_at,
        p.refund_last_queried_at
      FROM payments AS p
      WHERE ${refundCandidate}
    `);

    await assertNoRows(
      queryRunner,
      `
        SELECT p.id AS paymentId
        FROM payments AS p
        LEFT JOIN payment_refunds AS refund ON refund.payment_id = p.id
        WHERE (${refundCandidate})
          AND refund.id IS NULL
        LIMIT 1
      `,
      'Cannot create payment refunds: a refund candidate was not backfilled.',
    );

    await assertNoRows(
      queryRunner,
      `
        SELECT p.id AS paymentId
        FROM payments AS p
        INNER JOIN payment_refunds AS refund ON refund.payment_id = p.id
        WHERE NOT (
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
        LIMIT 1
      `,
      'Cannot create payment refunds: legacy refund data did not round-trip exactly.',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
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
      `
        SELECT p.id AS paymentId
        FROM payments AS p
        INNER JOIN payment_refunds AS refund ON refund.payment_id = p.id
        WHERE NOT (
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
        LIMIT 1
      `,
      'Cannot rollback payment refunds: refund data could not be restored to payments.',
    );

    await queryRunner.query('DROP TABLE payment_refunds');
  }
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
