import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AlignBookingMetadata1784774000000 implements MigrationInterface {
  name = 'AlignBookingMetadata1784774000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE bookings
        MODIFY cancelled_at datetime(6) NULL,
        MODIFY created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        MODIFY updated_at datetime(6) NOT NULL
          DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE bookings
        MODIFY cancelled_at datetime NULL,
        MODIFY created_at datetime NOT NULL DEFAULT (now()),
        MODIFY updated_at datetime NOT NULL DEFAULT (now())
    `);
  }
}
