import type { MigrationInterface, QueryRunner } from 'typeorm';

// Keep historical values local: replaying this migration must not depend on
// future changes to the application's AuditAction enum.
const previousActions =
  "'BOOKING_CREATED','BOOKING_STATUS_CHANGED','BOOKING_CANCELLED','ROOM_STATUS_CHANGED','PAYMENT_CONFIRMED','REFUND_REQUESTED','REFUND_COMPLETED','ACCOUNT_LOCKED','ACCOUNT_UNLOCKED'";
const newActions =
  "'CUSTOMER_INITIAL_PASSWORD_SET','ROOM_CALENDAR_BLOCKED','ROOM_CALENDAR_UNBLOCKED'";

export class AddCredentialCalendarAuditActions1784798000000 implements MigrationInterface {
  name = 'AddCredentialCalendarAuditActions1784798000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE audit_logs MODIFY COLUMN action enum(${previousActions},${newActions}) NOT NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(
      `SELECT COUNT(*) AS count FROM audit_logs WHERE action IN (${newActions})`,
    )) as Array<{ count: string | number }>;
    if (Number(rows[0]?.count ?? 0) > 0) {
      throw new Error(
        'Cannot remove credential/calendar audit actions while their audit records exist.',
      );
    }
    await queryRunner.query(
      `ALTER TABLE audit_logs MODIFY COLUMN action enum(${previousActions}) NOT NULL`,
    );
  }
}
