import type { MigrationInterface, QueryRunner } from 'typeorm';

interface UserAuditCountRow {
  userAuditCount: string | number;
}

export class AddUserAuditEntityType1784788000000 implements MigrationInterface {
  name = 'AddUserAuditEntityType1784788000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE audit_logs
      MODIFY COLUMN entity_type
        enum('BOOKING','ROOM','PAYMENT','CUSTOMER','USER') NOT NULL
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(`
      SELECT COUNT(*) AS userAuditCount
      FROM audit_logs
      WHERE entity_type = 'USER'
    `)) as UserAuditCountRow[];

    if (Number(rows[0]?.userAuditCount ?? 0) > 0) {
      throw new Error(
        'Cannot remove USER from audit_logs.entity_type while USER audit records exist.',
      );
    }

    await queryRunner.query(`
      ALTER TABLE audit_logs
      MODIFY COLUMN entity_type
        enum('BOOKING','ROOM','PAYMENT','CUSTOMER') NOT NULL
    `);
  }
}
