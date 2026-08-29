import type { MigrationInterface, QueryRunner } from 'typeorm';

interface RequestIntentCountRow {
  requestIntentCount: string | number;
}

export class AddBookingRequestIntent1784793000000 implements MigrationInterface {
  name = 'AddBookingRequestIntent1784793000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE bookings
        ADD COLUMN request_intent_actor_type varchar(16) NULL
          AFTER accepted_payment_id,
        ADD COLUMN request_intent_actor_id bigint NULL
          AFTER request_intent_actor_type,
        ADD COLUMN request_intent_key varchar(100) NULL
          AFTER request_intent_actor_id,
        ADD COLUMN request_intent_hash char(64) NULL
          AFTER request_intent_key,
        ADD UNIQUE KEY uq_bookings_request_intent
          (request_intent_actor_type, request_intent_actor_id, request_intent_key),
        ADD CONSTRAINT chk_bookings_request_intent_fields
          CHECK (
            (request_intent_key IS NULL
              AND request_intent_actor_type IS NULL
              AND request_intent_actor_id IS NULL
              AND request_intent_hash IS NULL)
            OR
            (request_intent_key IS NOT NULL
              AND request_intent_actor_type IS NOT NULL
              AND request_intent_actor_id IS NOT NULL
              AND request_intent_hash IS NOT NULL)
          )
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    const rows = (await queryRunner.query(`
      SELECT COUNT(*) AS requestIntentCount
      FROM bookings
      WHERE request_intent_actor_type IS NOT NULL
        OR request_intent_actor_id IS NOT NULL
        OR request_intent_key IS NOT NULL
        OR request_intent_hash IS NOT NULL
    `)) as RequestIntentCountRow[];

    if (Number(rows[0]?.requestIntentCount ?? 0) > 0) {
      throw new Error(
        'Cannot rollback booking request intent while keyed bookings exist. Preserve the idempotency evidence before reverting.',
      );
    }

    await queryRunner.query(`
      ALTER TABLE bookings
        DROP CHECK chk_bookings_request_intent_fields,
        DROP INDEX uq_bookings_request_intent,
        DROP COLUMN request_intent_hash,
        DROP COLUMN request_intent_key,
        DROP COLUMN request_intent_actor_id,
        DROP COLUMN request_intent_actor_type
    `);
  }
}
