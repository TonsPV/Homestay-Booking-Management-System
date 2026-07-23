import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserTokenVersion1784773000000 implements MigrationInterface {
  name = 'AddUserTokenVersion1784773000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        ADD token_version int NOT NULL DEFAULT 0 AFTER password_hash
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
        DROP COLUMN token_version
    `);
  }
}
