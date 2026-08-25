import type { MigrationInterface, QueryRunner } from 'typeorm';

export class HardenPositivePriceConstraints1784791000000 implements MigrationInterface {
  name = 'HardenPositivePriceConstraints1784791000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE room_types
        DROP CHECK chk_room_types_base_price,
        ADD CONSTRAINT chk_room_types_base_price
          CHECK (base_price > 0)
    `);

    await queryRunner.query(`
      ALTER TABLE bookings
        DROP CHECK chk_bookings_total_amount,
        ADD CONSTRAINT chk_bookings_total_amount
          CHECK (total_amount > 0)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE room_types
        DROP CHECK chk_room_types_base_price,
        ADD CONSTRAINT chk_room_types_base_price
          CHECK (base_price >= 0)
    `);

    await queryRunner.query(`
      ALTER TABLE bookings
        DROP CHECK chk_bookings_total_amount,
        ADD CONSTRAINT chk_bookings_total_amount
          CHECK (total_amount >= 0)
    `);
  }
}
