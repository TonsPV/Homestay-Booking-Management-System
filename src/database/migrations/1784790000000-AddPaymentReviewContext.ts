import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPaymentReviewContext1784790000000 implements MigrationInterface {
  name = 'AddPaymentReviewContext1784790000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE payments
        ADD review_reason enum(
          'BOOKING_CANCELLED',
          'ANOTHER_SUCCESSFUL_PAYMENT'
        ) NULL AFTER status,
        ADD review_canonical_payment_id bigint NULL AFTER review_reason
    `);

    await queryRunner.query(`
      UPDATE payments reviewed
      INNER JOIN bookings booking
        ON booking.id = reviewed.booking_id
      SET reviewed.review_reason = 'BOOKING_CANCELLED'
      WHERE reviewed.status = 'REQUIRES_REVIEW'
        AND booking.status = 'CANCELLED'
    `);

    await queryRunner.query(`
      CREATE TEMPORARY TABLE payment_review_canonical_backfill (
        booking_id bigint NOT NULL PRIMARY KEY,
        canonical_payment_id bigint NOT NULL
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      INSERT INTO payment_review_canonical_backfill (
        booking_id,
        canonical_payment_id
      )
      SELECT
        booking_id,
        MIN(id)
      FROM payments
      WHERE status = 'SUCCESS'
      GROUP BY booking_id
      HAVING COUNT(*) = 1
    `);

    await queryRunner.query(`
      UPDATE payments reviewed
      INNER JOIN payment_review_canonical_backfill canonical
        ON canonical.booking_id = reviewed.booking_id
        AND canonical.canonical_payment_id <> reviewed.id
      SET
        reviewed.review_reason = 'ANOTHER_SUCCESSFUL_PAYMENT',
        reviewed.review_canonical_payment_id = canonical.canonical_payment_id
      WHERE reviewed.status = 'REQUIRES_REVIEW'
        AND reviewed.review_reason IS NULL
    `);

    await queryRunner.query(`
      DROP TEMPORARY TABLE payment_review_canonical_backfill
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE payments
        DROP COLUMN review_canonical_payment_id,
        DROP COLUMN review_reason
    `);
  }
}
