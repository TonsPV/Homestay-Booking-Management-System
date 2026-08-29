import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Makes bookings.accepted_payment_id a same-booking ownership reference.
 * The scalar FK allowed a payment from another booking to be accepted.
 */
export class HardenAcceptedPaymentOwnership1784796000000 implements MigrationInterface {
  name = 'HardenAcceptedPaymentOwnership1784796000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await assertNoRows(
      queryRunner,
      `
        SELECT booking.id AS bookingId, booking.accepted_payment_id AS acceptedPaymentId
        FROM bookings AS booking
        LEFT JOIN payments AS payment
          ON payment.id = booking.accepted_payment_id
        WHERE booking.accepted_payment_id IS NOT NULL
          AND payment.id IS NULL
        LIMIT 1
      `,
      'Cannot harden accepted payment ownership: a booking points to a missing payment.',
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
      'Cannot harden accepted payment ownership: accepted payment belongs to another booking.',
    );

    await queryRunner.query(`
      ALTER TABLE payments
        ADD UNIQUE KEY uq_payments_id_booking (id, booking_id)
    `);

    await queryRunner.query(`
      ALTER TABLE bookings
        ADD KEY idx_bookings_accepted_payment_owner (accepted_payment_id, id),
        ADD CONSTRAINT fk_bookings_accepted_payment_owner
          FOREIGN KEY (accepted_payment_id, id)
          REFERENCES payments (id, booking_id)
          ON DELETE RESTRICT ON UPDATE RESTRICT
    `);

    await queryRunner.query(`
      ALTER TABLE bookings
        DROP FOREIGN KEY fk_bookings_accepted_payment,
        DROP INDEX uq_bookings_accepted_payment
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE bookings
        DROP FOREIGN KEY fk_bookings_accepted_payment_owner,
        DROP INDEX idx_bookings_accepted_payment_owner
    `);

    await queryRunner.query(`
      ALTER TABLE payments
        DROP INDEX uq_payments_id_booking
    `);

    await queryRunner.query(`
      ALTER TABLE bookings
        ADD UNIQUE KEY uq_bookings_accepted_payment (accepted_payment_id),
        ADD CONSTRAINT fk_bookings_accepted_payment
          FOREIGN KEY (accepted_payment_id) REFERENCES payments (id)
          ON DELETE RESTRICT ON UPDATE RESTRICT
    `);
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
