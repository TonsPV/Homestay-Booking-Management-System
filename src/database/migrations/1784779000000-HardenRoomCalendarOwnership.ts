import type { MigrationInterface, QueryRunner } from 'typeorm';

export class HardenRoomCalendarOwnership1784779000000 implements MigrationInterface {
  name = 'HardenRoomCalendarOwnership1784779000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE room_calendar
        DROP CHECK chk_room_calendar_booking_required,
        ADD CONSTRAINT chk_room_calendar_status_ownership
          CHECK (
            (status = 'RESERVED' AND booking_id IS NOT NULL)
            OR (status = 'BLOCKED' AND booking_id IS NULL)
          )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE room_calendar
        DROP CHECK chk_room_calendar_status_ownership,
        ADD CONSTRAINT chk_room_calendar_booking_required
          CHECK (status <> 'RESERVED' OR booking_id IS NOT NULL)
    `);
  }
}
