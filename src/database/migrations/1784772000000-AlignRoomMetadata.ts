import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AlignRoomMetadata1784772000000 implements MigrationInterface {
  name = 'AlignRoomMetadata1784772000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE rooms
        MODIFY created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        MODIFY updated_at datetime(6) NOT NULL
          DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        MODIFY deleted_at datetime(6) NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE rooms
        MODIFY created_at datetime NOT NULL DEFAULT (now()),
        MODIFY updated_at datetime NOT NULL DEFAULT (now()),
        MODIFY deleted_at datetime NULL
    `);
  }
}
