import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AlignAmenityJoinMetadata1784783000000 implements MigrationInterface {
  name = 'AlignAmenityJoinMetadata1784783000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE amenities
      MODIFY deleted_at datetime(6) NULL
    `);
    await queryRunner.query(`
      ALTER TABLE room_type_amenities
      DROP FOREIGN KEY fk_room_type_amenities_amenity
    `);
    await queryRunner.query(`
      ALTER TABLE room_type_amenities
      DROP FOREIGN KEY fk_room_type_amenities_room_type
    `);
    await queryRunner.query(`
      DROP INDEX idx_room_type_amenities_amenity
      ON room_type_amenities
    `);
    await queryRunner.query(`
      CREATE INDEX IDX_71a73dd29d1f5790255c7f52b1
      ON room_type_amenities (room_type_id)
    `);
    await queryRunner.query(`
      CREATE INDEX IDX_c29e4ff2d3b4656a47ee2c5eb1
      ON room_type_amenities (amenity_id)
    `);
    await queryRunner.query(`
      ALTER TABLE room_type_amenities
      ADD CONSTRAINT fk_room_type_amenities_room_type
      FOREIGN KEY (room_type_id) REFERENCES room_types (id)
      ON DELETE CASCADE ON UPDATE CASCADE
    `);
    await queryRunner.query(`
      ALTER TABLE room_type_amenities
      ADD CONSTRAINT fk_room_type_amenities_amenity
      FOREIGN KEY (amenity_id) REFERENCES amenities (id)
      ON DELETE NO ACTION ON UPDATE NO ACTION
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE room_type_amenities
      DROP FOREIGN KEY fk_room_type_amenities_amenity
    `);
    await queryRunner.query(`
      ALTER TABLE room_type_amenities
      DROP FOREIGN KEY fk_room_type_amenities_room_type
    `);
    await queryRunner.query(`
      DROP INDEX IDX_c29e4ff2d3b4656a47ee2c5eb1
      ON room_type_amenities
    `);
    await queryRunner.query(`
      DROP INDEX IDX_71a73dd29d1f5790255c7f52b1
      ON room_type_amenities
    `);
    await queryRunner.query(`
      CREATE INDEX idx_room_type_amenities_amenity
      ON room_type_amenities (amenity_id)
    `);
    await queryRunner.query(`
      ALTER TABLE room_type_amenities
      ADD CONSTRAINT fk_room_type_amenities_room_type
      FOREIGN KEY (room_type_id) REFERENCES room_types (id)
      ON DELETE CASCADE ON UPDATE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE room_type_amenities
      ADD CONSTRAINT fk_room_type_amenities_amenity
      FOREIGN KEY (amenity_id) REFERENCES amenities (id)
      ON DELETE CASCADE ON UPDATE RESTRICT
    `);
    await queryRunner.query(`
      ALTER TABLE amenities
      MODIFY deleted_at datetime NULL
    `);
  }
}
