import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRoomTypeBedType1784785000000 implements MigrationInterface {
  name = 'AddRoomTypeBedType1784785000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE room_types
        ADD bed_type varchar(120) NULL AFTER description
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE room_types
        DROP COLUMN bed_type
    `);
  }
}
