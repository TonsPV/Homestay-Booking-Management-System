import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCustomerTokenVersion1784780000000 implements MigrationInterface {
  name = 'AddCustomerTokenVersion1784780000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE customers
        ADD token_version int NOT NULL DEFAULT 0 AFTER password_hash
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE customers
        DROP COLUMN token_version
    `);
  }
}
