import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentReviewStatus1784777000000 implements MigrationInterface {
  name = 'AddPaymentReviewStatus1784777000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE payments
        MODIFY status enum(
          'PENDING',
          'SUCCESS',
          'FAILED',
          'REQUIRES_REVIEW',
          'REFUNDED'
        ) NOT NULL DEFAULT 'PENDING'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE payments
      SET
        status = 'FAILED',
        gateway_response_code = COALESCE(
          gateway_response_code,
          'REVIEW'
        )
      WHERE status = 'REQUIRES_REVIEW'
    `);

    await queryRunner.query(`
      ALTER TABLE payments
        MODIFY status enum(
          'PENDING',
          'SUCCESS',
          'FAILED',
          'REFUNDED'
        ) NOT NULL DEFAULT 'PENDING'
    `);
  }
}
