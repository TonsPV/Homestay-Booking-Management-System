import type { MigrationInterface, QueryRunner } from 'typeorm';

interface ForeignKeyRuleRow {
  updateRule: string;
}

interface IndexCountRow {
  indexCount: string | number;
}

export class AlignRoomTypeBedMetadata1784789000000 implements MigrationInterface {
  name = 'AlignRoomTypeBedMetadata1784789000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    const foreignKey = await this.getForeignKeyRule(queryRunner);
    const hasLegacyIndex = await this.hasLegacyIndex(queryRunner);

    if (foreignKey?.updateRule === 'NO ACTION' && !hasLegacyIndex) {
      return;
    }

    if (foreignKey !== undefined) {
      await queryRunner.query(`
        ALTER TABLE room_type_beds
        DROP FOREIGN KEY fk_room_type_beds_room_type
      `);
    }

    if (hasLegacyIndex) {
      await queryRunner.query(`
        DROP INDEX idx_room_type_beds_room_type ON room_type_beds
      `);
    }

    await queryRunner.query(`
      ALTER TABLE room_type_beds
      ADD CONSTRAINT fk_room_type_beds_room_type
        FOREIGN KEY (room_type_id) REFERENCES room_types (id)
        ON DELETE CASCADE ON UPDATE NO ACTION
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const foreignKey = await this.getForeignKeyRule(queryRunner);
    const hasLegacyIndex = await this.hasLegacyIndex(queryRunner);

    if (foreignKey !== undefined) {
      await queryRunner.query(`
        ALTER TABLE room_type_beds
        DROP FOREIGN KEY fk_room_type_beds_room_type
      `);
    }

    if (!hasLegacyIndex) {
      await queryRunner.query(`
        CREATE INDEX idx_room_type_beds_room_type
        ON room_type_beds (room_type_id)
      `);
    }

    await queryRunner.query(`
      ALTER TABLE room_type_beds
      ADD CONSTRAINT fk_room_type_beds_room_type
        FOREIGN KEY (room_type_id) REFERENCES room_types (id)
        ON DELETE CASCADE ON UPDATE CASCADE
    `);
  }

  private async getForeignKeyRule(
    queryRunner: QueryRunner,
  ): Promise<ForeignKeyRuleRow | undefined> {
    const rows = (await queryRunner.query(`
      SELECT UPDATE_RULE AS updateRule
      FROM INFORMATION_SCHEMA.REFERENTIAL_CONSTRAINTS
      WHERE CONSTRAINT_SCHEMA = DATABASE()
        AND TABLE_NAME = 'room_type_beds'
        AND CONSTRAINT_NAME = 'fk_room_type_beds_room_type'
    `)) as ForeignKeyRuleRow[];

    return rows[0];
  }

  private async hasLegacyIndex(queryRunner: QueryRunner): Promise<boolean> {
    const rows = (await queryRunner.query(`
      SELECT COUNT(*) AS indexCount
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = 'room_type_beds'
        AND INDEX_NAME = 'idx_room_type_beds_room_type'
    `)) as IndexCountRow[];

    return Number(rows[0]?.indexCount ?? 0) > 0;
  }
}
