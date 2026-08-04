import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDashboardQueryIndexes1784782000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE INDEX idx_bookings_created_at_status
      ON bookings (created_at, status)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_payments_status_paid_at
      ON payments (status, paid_at)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_payments_status_refunded_at
      ON payments (status, refunded_at)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_payments_created_at_status
      ON payments (created_at, status)
    `);
    await queryRunner.query(`
      CREATE INDEX idx_room_calendar_status_date
      ON room_calendar (status, stay_date)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX idx_room_calendar_status_date ON room_calendar',
    );
    await queryRunner.query(
      'DROP INDEX idx_payments_created_at_status ON payments',
    );
    await queryRunner.query(
      'DROP INDEX idx_payments_status_refunded_at ON payments',
    );
    await queryRunner.query(
      'DROP INDEX idx_payments_status_paid_at ON payments',
    );
    await queryRunner.query(
      'DROP INDEX idx_bookings_created_at_status ON bookings',
    );
  }
}
