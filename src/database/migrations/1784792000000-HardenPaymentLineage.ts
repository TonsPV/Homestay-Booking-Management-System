import type { MigrationInterface, QueryRunner } from 'typeorm';

interface AcceptedPaymentCountRow {
  acceptedPaymentCount: string | number;
}

/**
 * Materializes the one accepted payment lineage per booking.
 *
 * The preflight deliberately fails closed when legacy data already contains
 * more than one accepted-state payment for a booking.  Picking one silently
 * would destroy the evidence needed for reconciliation.
 */
export class HardenPaymentLineage1784792000000 implements MigrationInterface {
  name = 'HardenPaymentLineage1784792000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const conflicts = (await queryRunner.query(`
      SELECT booking_id AS bookingId, COUNT(*) AS paymentCount
      FROM payments
      WHERE status IN ('SUCCESS', 'REFUND_PENDING', 'REFUNDED')
      GROUP BY booking_id
      HAVING COUNT(*) > 1
      LIMIT 1
    `)) as Array<{ bookingId: string; paymentCount: string | number }>;

    if (conflicts.length > 0) {
      const conflict = conflicts[0];
      throw new Error(
        `Cannot add payment lineage guard: booking ${conflict.bookingId} has ${conflict.paymentCount} accepted-state payments. Reconcile legacy payment data first.`,
      );
    }

    await queryRunner.query(`
      ALTER TABLE bookings
        ADD COLUMN accepted_payment_id bigint NULL AFTER payment_status,
        ADD UNIQUE KEY uq_bookings_accepted_payment (accepted_payment_id),
        ADD CONSTRAINT fk_bookings_accepted_payment
          FOREIGN KEY (accepted_payment_id) REFERENCES payments(id)
    `);

    await queryRunner.query(`
      UPDATE bookings AS booking
      INNER JOIN payments AS payment
        ON payment.booking_id = booking.id
       AND payment.status IN ('SUCCESS', 'REFUND_PENDING', 'REFUNDED')
      SET booking.accepted_payment_id = payment.id
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(`
      SELECT COUNT(*) AS acceptedPaymentCount
      FROM bookings
      WHERE accepted_payment_id IS NOT NULL
    `)) as AcceptedPaymentCountRow[];

    if (Number(rows[0]?.acceptedPaymentCount ?? 0) > 0) {
      throw new Error(
        'Cannot rollback payment lineage while accepted payment pointers exist. Reconcile and snapshot the lineage data first.',
      );
    }

    await queryRunner.query(`
      ALTER TABLE bookings
        DROP FOREIGN KEY fk_bookings_accepted_payment,
        DROP INDEX uq_bookings_accepted_payment,
        DROP COLUMN accepted_payment_id
    `);
  }
}
