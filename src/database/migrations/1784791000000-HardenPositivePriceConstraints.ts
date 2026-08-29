import type { MigrationInterface, QueryRunner } from 'typeorm';

export class HardenPositivePriceConstraints1784791000000 implements MigrationInterface {
  name = 'HardenPositivePriceConstraints1784791000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const legacyRows = (await queryRunner.query(`
      SELECT 'room_types' AS tableName, id, base_price AS amount
      FROM room_types
      WHERE base_price <= 0
      UNION ALL
      SELECT 'bookings' AS tableName, id, total_amount AS amount
      FROM bookings
      WHERE total_amount <= 0
      LIMIT 1
    `)) as Array<{ tableName: string; id: string; amount: string }>;

    if (legacyRows.length > 0) {
      const row = legacyRows[0];
      throw new Error(
        `Cannot enforce positive prices: ${row.tableName} row ${row.id} has amount ${row.amount}. Remediate legacy data before rerunning the migration.`,
      );
    }

    await queryRunner.query(`
      ALTER TABLE room_types
        DROP CHECK chk_room_types_base_price,
        ADD CONSTRAINT chk_room_types_base_price
          CHECK (base_price > 0)
    `);

    await queryRunner.query(`
      ALTER TABLE bookings
        DROP CHECK chk_bookings_total_amount,
        ADD CONSTRAINT chk_bookings_total_amount
          CHECK (total_amount > 0)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE room_types
        DROP CHECK chk_room_types_base_price,
        ADD CONSTRAINT chk_room_types_base_price
          CHECK (base_price >= 0)
    `);

    await queryRunner.query(`
      ALTER TABLE bookings
        DROP CHECK chk_bookings_total_amount,
        ADD CONSTRAINT chk_bookings_total_amount
          CHECK (total_amount >= 0)
    `);
  }
}
