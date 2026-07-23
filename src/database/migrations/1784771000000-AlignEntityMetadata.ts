import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AlignEntityMetadata1784771000000 implements MigrationInterface {
  name = 'AlignEntityMetadata1784771000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['users', 'customers', 'room_types']) {
      await queryRunner.query(`
        ALTER TABLE ${table}
          MODIFY created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
          MODIFY updated_at datetime(6) NOT NULL
            DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
          MODIFY deleted_at datetime(6) NULL
      `);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['users', 'customers', 'room_types']) {
      await queryRunner.query(`
        ALTER TABLE ${table}
          MODIFY created_at datetime NOT NULL DEFAULT (now()),
          MODIFY updated_at datetime NOT NULL DEFAULT (now()),
          MODIFY deleted_at datetime NULL
      `);
    }
  }
}
