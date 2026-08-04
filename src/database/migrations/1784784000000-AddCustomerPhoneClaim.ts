import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCustomerPhoneClaim1784784000000 implements MigrationInterface {
  name = 'AddCustomerPhoneClaim1784784000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE customers
        ADD phone_verified_at datetime(6) NULL AFTER token_version
    `);
    await queryRunner.query(`
      CREATE TABLE customer_claim_challenges (
        id varchar(36) NOT NULL,
        customer_id bigint NOT NULL,
        phone_snapshot varchar(30) NOT NULL,
        otp_hash varchar(255) NOT NULL,
        claim_token_hash varchar(255) NULL,
        purpose enum('CLAIM_ACCOUNT') NOT NULL,
        status enum('PENDING', 'VERIFIED', 'CONSUMED', 'EXPIRED', 'BLOCKED') NOT NULL,
        attempt_count int UNSIGNED NOT NULL DEFAULT 0,
        expires_at datetime(6) NOT NULL,
        verified_at datetime(6) NULL,
        claim_token_expires_at datetime(6) NULL,
        consumed_at datetime(6) NULL,
        created_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
        updated_at datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
        INDEX idx_customer_claim_customer_purpose_status (customer_id, purpose, status),
        INDEX idx_customer_claim_phone_purpose_created (phone_snapshot, purpose, created_at),
        INDEX idx_customer_claim_status_expires (status, expires_at),
        PRIMARY KEY (id),
        CONSTRAINT fk_customer_claim_challenges_customer
          FOREIGN KEY (customer_id) REFERENCES customers(id)
          ON DELETE CASCADE ON UPDATE NO ACTION
      ) ENGINE=InnoDB
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TABLE customer_claim_challenges
    `);
    await queryRunner.query(`
      ALTER TABLE customers
        DROP COLUMN phone_verified_at
    `);
  }
}
