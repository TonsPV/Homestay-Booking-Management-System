import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddVnpayPaymentFields1784776000000 implements MigrationInterface {
  name = 'AddVnpayPaymentFields1784776000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE payments
        ADD gateway_reference varchar(100) NULL AFTER gateway_name,
        ADD gateway_payment_url varchar(2048) NULL
          AFTER gateway_transaction_id,
        ADD gateway_response_code varchar(10) NULL
          AFTER gateway_payment_url,
        ADD gateway_transaction_status varchar(10) NULL
          AFTER gateway_response_code,
        ADD expires_at datetime(6) NULL AFTER refunded_at,
        ADD UNIQUE KEY uq_payments_gateway_reference (gateway_reference),
        ADD KEY idx_payments_expires_at (expires_at)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE payments
        DROP INDEX idx_payments_expires_at,
        DROP INDEX uq_payments_gateway_reference,
        DROP COLUMN expires_at,
        DROP COLUMN gateway_transaction_status,
        DROP COLUMN gateway_response_code,
        DROP COLUMN gateway_payment_url,
        DROP COLUMN gateway_reference
    `);
  }
}
