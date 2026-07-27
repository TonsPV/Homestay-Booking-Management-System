import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentManagement1784775000000 implements MigrationInterface {
  name = 'AddPaymentManagement1784775000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE bookings
        ADD payment_expires_at datetime(6) NULL AFTER payment_status,
        ADD KEY idx_bookings_payment_expires_at (payment_expires_at)
    `);

    await queryRunner.query(`
      ALTER TABLE payments
        ADD currency char(3) NOT NULL DEFAULT 'VND' AFTER amount,
        ADD idempotency_key varchar(100) NULL AFTER gateway_transaction_id,
        ADD created_by_user_id bigint NULL AFTER idempotency_key,
        ADD refunded_by_user_id bigint NULL AFTER created_by_user_id,
        MODIFY paid_at datetime(6) NULL,
        ADD refunded_at datetime(6) NULL AFTER paid_at,
        MODIFY created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        ADD updated_at datetime(6) NOT NULL
          DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        ADD UNIQUE KEY uq_payments_idempotency (idempotency_key),
        ADD KEY idx_payments_created_by_user (created_by_user_id),
        ADD KEY idx_payments_refunded_by_user (refunded_by_user_id),
        ADD CONSTRAINT fk_payments_created_by_user
          FOREIGN KEY (created_by_user_id) REFERENCES users (id),
        ADD CONSTRAINT fk_payments_refunded_by_user
          FOREIGN KEY (refunded_by_user_id) REFERENCES users (id),
        ADD CONSTRAINT chk_payments_currency CHECK (currency = 'VND')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE payments
        DROP FOREIGN KEY fk_payments_refunded_by_user,
        DROP FOREIGN KEY fk_payments_created_by_user,
        DROP CHECK chk_payments_currency,
        DROP INDEX idx_payments_refunded_by_user,
        DROP INDEX idx_payments_created_by_user,
        DROP INDEX uq_payments_idempotency,
        DROP COLUMN updated_at,
        DROP COLUMN refunded_at,
        MODIFY paid_at datetime NULL,
        DROP COLUMN refunded_by_user_id,
        DROP COLUMN created_by_user_id,
        DROP COLUMN idempotency_key,
        DROP COLUMN currency,
        MODIFY created_at datetime NOT NULL DEFAULT (now())
    `);

    await queryRunner.query(`
      ALTER TABLE bookings
        DROP INDEX idx_bookings_payment_expires_at,
        DROP COLUMN payment_expires_at
    `);
  }
}
