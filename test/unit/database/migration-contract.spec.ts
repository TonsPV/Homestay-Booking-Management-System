import type { MigrationInterface, QueryRunner } from 'typeorm';

import AppDataSource from '../../../src/database/data-source';
import { InitialSchemaBaseline1784770000000 } from '../../../src/database/migrations/1784770000000-InitialSchemaBaseline';
import { AlignEntityMetadata1784771000000 } from '../../../src/database/migrations/1784771000000-AlignEntityMetadata';
import { AlignRoomMetadata1784772000000 } from '../../../src/database/migrations/1784772000000-AlignRoomMetadata';
import { AddUserTokenVersion1784773000000 } from '../../../src/database/migrations/1784773000000-AddUserTokenVersion';
import { AlignBookingMetadata1784774000000 } from '../../../src/database/migrations/1784774000000-AlignBookingMetadata';
import { AddPaymentManagement1784775000000 } from '../../../src/database/migrations/1784775000000-AddPaymentManagement';
import { AddVnpayPaymentFields1784776000000 } from '../../../src/database/migrations/1784776000000-AddVnpayPaymentFields';
import { AddPaymentReviewStatus1784777000000 } from '../../../src/database/migrations/1784777000000-AddPaymentReviewStatus';
import { AddVnpayRefundManagement1784778000000 } from '../../../src/database/migrations/1784778000000-AddVnpayRefundManagement';
import { HardenRoomCalendarOwnership1784779000000 } from '../../../src/database/migrations/1784779000000-HardenRoomCalendarOwnership';
import { AddCustomerTokenVersion1784780000000 } from '../../../src/database/migrations/1784780000000-AddCustomerTokenVersion';
import { AddAmenities1784781000000 } from '../../../src/database/migrations/1784781000000-AddAmenities';
import { AddDashboardQueryIndexes1784782000000 } from '../../../src/database/migrations/1784782000000-AddDashboardQueryIndexes';
import { AlignAmenityJoinMetadata1784783000000 } from '../../../src/database/migrations/1784783000000-AlignAmenityJoinMetadata';
import { AddCustomerPhoneClaim1784784000000 } from '../../../src/database/migrations/1784784000000-AddCustomerPhoneClaim';
import { AddRoomTypeBedType1784785000000 } from '../../../src/database/migrations/1784785000000-AddRoomTypeBedType';
import { CreateRoomTypeBeds1784786000000 } from '../../../src/database/migrations/1784786000000-CreateRoomTypeBeds';
import { CreateAuditLogs1784787000000 } from '../../../src/database/migrations/1784787000000-CreateAuditLogs';
import { AddUserAuditEntityType1784788000000 } from '../../../src/database/migrations/1784788000000-AddUserAuditEntityType';
import { AlignRoomTypeBedMetadata1784789000000 } from '../../../src/database/migrations/1784789000000-AlignRoomTypeBedMetadata';
import { AddPaymentReviewContext1784790000000 } from '../../../src/database/migrations/1784790000000-AddPaymentReviewContext';
import { HardenPositivePriceConstraints1784791000000 } from '../../../src/database/migrations/1784791000000-HardenPositivePriceConstraints';
import { AddBookingRequestIntent1784793000000 } from '../../../src/database/migrations/1784793000000-AddBookingRequestIntent';
import { HardenPaymentLineage1784792000000 } from '../../../src/database/migrations/1784792000000-HardenPaymentLineage';
import { RetireCustomerPhoneClaim1784794000000 } from '../../../src/database/migrations/1784794000000-RetireCustomerPhoneClaim';

const MIGRATION_CLASSES = [
  InitialSchemaBaseline1784770000000,
  AlignEntityMetadata1784771000000,
  AlignRoomMetadata1784772000000,
  AddUserTokenVersion1784773000000,
  AlignBookingMetadata1784774000000,
  AddPaymentManagement1784775000000,
  AddVnpayPaymentFields1784776000000,
  AddPaymentReviewStatus1784777000000,
  AddVnpayRefundManagement1784778000000,
  HardenRoomCalendarOwnership1784779000000,
  AddCustomerTokenVersion1784780000000,
  AddAmenities1784781000000,
  AddDashboardQueryIndexes1784782000000,
  AlignAmenityJoinMetadata1784783000000,
  AddCustomerPhoneClaim1784784000000,
  AddRoomTypeBedType1784785000000,
  CreateRoomTypeBeds1784786000000,
  CreateAuditLogs1784787000000,
  AddUserAuditEntityType1784788000000,
  AlignRoomTypeBedMetadata1784789000000,
  AddPaymentReviewContext1784790000000,
  HardenPositivePriceConstraints1784791000000,
  HardenPaymentLineage1784792000000,
  AddBookingRequestIntent1784793000000,
  RetireCustomerPhoneClaim1784794000000,
] as const;

describe('database migration contract', () => {
  it('registers every migration once in timestamp order with synchronize off', () => {
    const registered = AppDataSource.options.migrations;

    expect(AppDataSource.options.synchronize).toBe(false);
    expect(Array.isArray(registered)).toBe(true);
    expect(registered).toEqual([...MIGRATION_CLASSES]);

    const timestamps = MIGRATION_CLASSES.map(({ name }) =>
      Number(name.match(/(\d{13})$/)?.[1]),
    );
    expect(timestamps.every(Number.isFinite)).toBe(true);
    expect(timestamps).toEqual(
      [...timestamps].sort((left, right) => left - right),
    );
    expect(new Set(timestamps).size).toBe(timestamps.length);
  });

  it.each(
    MIGRATION_CLASSES.slice(1).map((Migration) => [Migration.name, Migration]),
  )('%s has executable up and down SQL', async (_name, Migration) => {
    const migration = new Migration() as MigrationInterface;
    const upSql: string[] = [];
    const downSql: string[] = [];
    const upQuery = jest.fn((sql: string) => {
      upSql.push(sql);
      return Promise.resolve([]);
    });
    const downQuery = jest.fn((sql: string) => {
      downSql.push(sql);
      return Promise.resolve([]);
    });

    await migration.up({
      query: upQuery,
    } as unknown as QueryRunner);
    await migration.down?.({
      query: downQuery,
    } as unknown as QueryRunner);

    expect(upQuery).toHaveBeenCalled();
    expect(downQuery).toHaveBeenCalled();
    expect(
      [...upSql, ...downSql].every((sql) =>
        /\b(ALTER|CREATE|DROP|UPDATE|DELETE|INSERT|SELECT)\b/i.test(sql),
      ),
    ).toBe(true);
  });

  it('marks the initial baseline as backup-only instead of pretending rollback is safe', async () => {
    const migration = new InitialSchemaBaseline1784770000000();

    await expect(migration.down()).rejects.toThrow(
      'Restore from a database backup instead.',
    );
  });

  it('keeps the legacy bed_type column while creating the normalized table', async () => {
    const migration = new CreateRoomTypeBeds1784786000000();
    const upSql: string[] = [];
    const downSql: string[] = [];
    const upQuery = jest.fn((sql: string) => {
      upSql.push(sql);
      return Promise.resolve([]);
    });
    const downQuery = jest.fn((sql: string) => {
      downSql.push(sql);
      return Promise.resolve([]);
    });

    await migration.up({ query: upQuery } as unknown as QueryRunner);
    await migration.down?.({ query: downQuery } as unknown as QueryRunner);

    expect(upSql[0]).toContain('CREATE TABLE room_type_beds');
    expect(upSql[0]).toContain(
      'UNIQUE KEY uq_room_type_beds_room_type_bed_type',
    );
    expect(upSql[0]).toContain('CHECK (quantity > 0)');
    expect(upSql[0]).not.toMatch(/DROP\s+COLUMN\s+bed_type/i);
    expect(downSql).toEqual(['DROP TABLE room_type_beds']);
  });

  it('preserves the historical query-index migration rollback contract', async () => {
    const migration = new AddDashboardQueryIndexes1784782000000();
    const query = jest.fn().mockResolvedValue(undefined);
    const queryRunner = { query } as unknown as QueryRunner;

    await migration.up(queryRunner);
    const upSql = query.mock.calls
      .map(([sql]) => String(sql).replace(/\s+/g, ' '))
      .join('\n');

    expect(upSql).toContain('idx_bookings_created_at_status');
    expect(upSql).toContain('idx_payments_status_paid_at');
    expect(upSql).toContain('idx_payments_status_refunded_at');
    expect(upSql).toContain('idx_payments_created_at_status');
    expect(upSql).toContain('idx_room_calendar_status_date');

    query.mockClear();
    await migration.down(queryRunner);
    const downCalls = query.mock.calls as unknown as Array<[string]>;

    expect(query).toHaveBeenCalledTimes(5);
    expect(downCalls[0]?.[0]).toContain('idx_room_calendar_status_date');
  });

  it('hardens positive price constraints and restores the previous checks on rollback', async () => {
    const migration = new HardenPositivePriceConstraints1784791000000();
    const upSql: string[] = [];
    const downSql: string[] = [];
    const upQuery = jest.fn((sql: string) => {
      upSql.push(sql);
      return Promise.resolve([]);
    });
    const downQuery = jest.fn((sql: string) => {
      downSql.push(sql);
      return Promise.resolve([]);
    });

    await migration.up({ query: upQuery } as unknown as QueryRunner);
    await migration.down({ query: downQuery } as unknown as QueryRunner);

    expect(upSql.join('\n')).toContain('CHECK (base_price > 0)');
    expect(upSql.join('\n')).toContain('CHECK (total_amount > 0)');
    expect(downSql.join('\n')).toContain('CHECK (base_price >= 0)');
    expect(downSql.join('\n')).toContain('CHECK (total_amount >= 0)');
  });

  it('fails closed when legacy zero-price rows are present', async () => {
    const migration = new HardenPositivePriceConstraints1784791000000();
    const query = jest.fn((sql: string) => {
      if (/SELECT 'room_types'/i.test(sql)) {
        return Promise.resolve([
          { tableName: 'room_types', id: '7', amount: '0.00' },
        ]);
      }

      return Promise.resolve([]);
    });

    await expect(
      migration.up({ query } as unknown as QueryRunner),
    ).rejects.toThrow('Remediate legacy data before rerunning the migration.');
    expect(
      query.mock.calls.some(([sql]: [string]) => /ALTER TABLE/i.test(sql)),
    ).toBe(false);
  });

  it('fails closed when legacy payment lineage is already ambiguous', async () => {
    const migration = new HardenPaymentLineage1784792000000();
    const query = jest.fn((sql: string) => {
      if (/GROUP BY booking_id/i.test(sql)) {
        return Promise.resolve([{ bookingId: '42', paymentCount: '2' }]);
      }

      return Promise.resolve([]);
    });

    await expect(
      migration.up({ query } as unknown as QueryRunner),
    ).rejects.toThrow('Reconcile legacy payment data first.');
    expect(
      query.mock.calls.some(([sql]: [string]) => /ALTER TABLE/i.test(sql)),
    ).toBe(false);
  });

  it('refuses to drop accepted payment lineage after it has been used', async () => {
    const migration = new HardenPaymentLineage1784792000000();
    const query = jest.fn((sql: string) => {
      if (/accepted_payment_id IS NOT NULL/i.test(sql)) {
        return Promise.resolve([{ acceptedPaymentCount: '1' }]);
      }

      return Promise.resolve([]);
    });

    await expect(
      migration.down({ query } as unknown as QueryRunner),
    ).rejects.toThrow('accepted payment pointers exist');
    expect(
      query.mock.calls.some(([sql]: [string]) => /DROP FOREIGN KEY/i.test(sql)),
    ).toBe(false);
  });

  it('refuses to drop booking request intent after keyed bookings exist', async () => {
    const migration = new AddBookingRequestIntent1784793000000();
    const query = jest.fn((sql: string) => {
      if (/request_intent_actor_type IS NOT NULL/i.test(sql)) {
        return Promise.resolve([{ requestIntentCount: '1' }]);
      }

      return Promise.resolve([]);
    });

    await expect(
      migration.down({ query } as unknown as QueryRunner),
    ).rejects.toThrow('keyed bookings exist');
    expect(
      query.mock.calls.some(([sql]: [string]) => /DROP CHECK/i.test(sql)),
    ).toBe(false);
  });

  it('fails closed before retiring customer claim evidence', async () => {
    const migration = new RetireCustomerPhoneClaim1784794000000();
    const query = jest.fn((sql: string) => {
      if (/FROM customer_claim_challenges/i.test(sql)) {
        return Promise.resolve([{ challengeCount: '1' }]);
      }

      return Promise.resolve([]);
    });

    await expect(
      migration.up({ query } as unknown as QueryRunner),
    ).rejects.toThrow('claim evidence exists');
    expect(
      query.mock.calls.some(([sql]: [string]) => /DROP TABLE/i.test(sql)),
    ).toBe(false);
  });

  it('restores the retired customer claim schema on rollback', async () => {
    const migration = new RetireCustomerPhoneClaim1784794000000();
    const downQuery = jest.fn().mockResolvedValue([]);

    await migration.down({ query: downQuery } as unknown as QueryRunner);

    const downSql = downQuery.mock.calls.map(([sql]) => String(sql));
    expect(downSql[0]).toContain('ADD phone_verified_at datetime(6)');
    expect(downSql[1]).toContain('CREATE TABLE customer_claim_challenges');
  });

  it('refuses to narrow the audit entity enum while USER history exists', async () => {
    const migration = new AddUserAuditEntityType1784788000000();
    const query = jest.fn((sql: string) => {
      if (/SELECT COUNT\(\*\)/i.test(sql)) {
        return Promise.resolve([{ userAuditCount: '1' }]);
      }

      return Promise.resolve([]);
    });

    await expect(
      migration.down({ query } as unknown as QueryRunner),
    ).rejects.toThrow(
      'Cannot remove USER from audit_logs.entity_type while USER audit records exist.',
    );
    expect(
      query.mock.calls.some(([sql]: [string]) => /ALTER TABLE/i.test(sql)),
    ).toBe(false);
  });
});
