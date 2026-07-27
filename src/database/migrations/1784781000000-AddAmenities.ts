import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAmenities1784781000000 implements MigrationInterface {
  name = 'AddAmenities1784781000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE amenities (
        id bigint NOT NULL AUTO_INCREMENT,
        name varchar(120) NOT NULL,
        description varchar(500) NULL,
        created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6)
          ON UPDATE CURRENT_TIMESTAMP(6),
        deleted_at datetime NULL,
        PRIMARY KEY (id),
        UNIQUE KEY uq_amenities_name (name)
      ) ENGINE=InnoDB
    `);

    await queryRunner.query(`
      CREATE TABLE room_type_amenities (
        room_type_id bigint NOT NULL,
        amenity_id bigint NOT NULL,
        PRIMARY KEY (room_type_id, amenity_id),
        KEY idx_room_type_amenities_amenity (amenity_id),
        CONSTRAINT fk_room_type_amenities_room_type
          FOREIGN KEY (room_type_id) REFERENCES room_types (id)
          ON DELETE CASCADE ON UPDATE RESTRICT,
        CONSTRAINT fk_room_type_amenities_amenity
          FOREIGN KEY (amenity_id) REFERENCES amenities (id)
          ON DELETE CASCADE ON UPDATE RESTRICT
      ) ENGINE=InnoDB
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE room_type_amenities');
    await queryRunner.query('DROP TABLE amenities');
  }
}
