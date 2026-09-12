import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateCustomerAuthIdentities1784800000000 implements MigrationInterface {
  name = 'CreateCustomerAuthIdentities1784800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE customer_auth_identities (
        id bigint NOT NULL AUTO_INCREMENT,
        customer_id bigint NOT NULL,
        provider varchar(32) NOT NULL,
        provider_subject varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
        created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        PRIMARY KEY (id),
        UNIQUE KEY uq_customer_auth_identity_provider_subject
          (provider, provider_subject),
        UNIQUE KEY uq_customer_auth_identity_customer_provider
          (customer_id, provider),
        KEY idx_customer_auth_identity_customer (customer_id),
        CONSTRAINT customer_auth_identities_ibfk_1
          FOREIGN KEY (customer_id) REFERENCES customers (id)
          ON DELETE RESTRICT ON UPDATE RESTRICT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE customer_auth_identities');
  }
}
