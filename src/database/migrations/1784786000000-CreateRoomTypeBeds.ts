import type { MigrationInterface, QueryRunner } from 'typeorm';

import { parseLegacyBedType } from '../../module/room-type/bed-configuration';

interface LegacyRoomTypeRow {
  id: string;
  bed_type: string | null;
}

export class CreateRoomTypeBeds1784786000000 implements MigrationInterface {
  name = 'CreateRoomTypeBeds1784786000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE room_type_beds (
        id bigint NOT NULL AUTO_INCREMENT,
        room_type_id bigint NOT NULL,
        bed_type varchar(30) NOT NULL,
        quantity int NOT NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_room_type_beds_room_type_bed_type
          (room_type_id, bed_type),
        CONSTRAINT fk_room_type_beds_room_type
          FOREIGN KEY (room_type_id) REFERENCES room_types (id)
          ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT chk_room_type_beds_quantity CHECK (quantity > 0),
        CONSTRAINT chk_room_type_beds_bed_type CHECK (
          bed_type IN ('SINGLE','DOUBLE','QUEEN','KING','BUNK','SOFA_BED')
        )
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    const legacyRows = (await queryRunner.query(`
      SELECT id, bed_type
      FROM room_types
      WHERE bed_type IS NOT NULL AND TRIM(bed_type) <> ''
      ORDER BY id ASC
    `)) as LegacyRoomTypeRow[];

    for (const row of legacyRows) {
      const configurations = parseLegacyBedType(row.bed_type ?? '');

      if (configurations === null) {
        continue;
      }

      for (const configuration of configurations) {
        await queryRunner.query(
          `
            INSERT INTO room_type_beds (room_type_id, bed_type, quantity)
            VALUES (?, ?, ?)
          `,
          [row.id, configuration.type, configuration.quantity],
        );
      }
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE room_type_beds');
  }
}
