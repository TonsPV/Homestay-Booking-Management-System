import type { MigrationInterface, QueryRunner } from 'typeorm';

import AppDataSource from './data-source';
import { InitialSchemaBaseline1784770000000 } from './migrations/1784770000000-InitialSchemaBaseline';
import { AlignEntityMetadata1784771000000 } from './migrations/1784771000000-AlignEntityMetadata';
import { AlignRoomMetadata1784772000000 } from './migrations/1784772000000-AlignRoomMetadata';
import { AddUserTokenVersion1784773000000 } from './migrations/1784773000000-AddUserTokenVersion';
import { AlignBookingMetadata1784774000000 } from './migrations/1784774000000-AlignBookingMetadata';
import { AddPaymentManagement1784775000000 } from './migrations/1784775000000-AddPaymentManagement';
import { AddVnpayPaymentFields1784776000000 } from './migrations/1784776000000-AddVnpayPaymentFields';
import { AddPaymentReviewStatus1784777000000 } from './migrations/1784777000000-AddPaymentReviewStatus';
import { AddVnpayRefundManagement1784778000000 } from './migrations/1784778000000-AddVnpayRefundManagement';
import { HardenRoomCalendarOwnership1784779000000 } from './migrations/1784779000000-HardenRoomCalendarOwnership';
import { AddCustomerTokenVersion1784780000000 } from './migrations/1784780000000-AddCustomerTokenVersion';
import { AddAmenities1784781000000 } from './migrations/1784781000000-AddAmenities';
import { AddDashboardQueryIndexes1784782000000 } from './migrations/1784782000000-AddDashboardQueryIndexes';
import { AlignAmenityJoinMetadata1784783000000 } from './migrations/1784783000000-AlignAmenityJoinMetadata';
import { AddCustomerPhoneClaim1784784000000 } from './migrations/1784784000000-AddCustomerPhoneClaim';
import { AddRoomTypeBedType1784785000000 } from './migrations/1784785000000-AddRoomTypeBedType';

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
        /\b(ALTER|CREATE|DROP|UPDATE|DELETE|INSERT)\b/i.test(sql),
      ),
    ).toBe(true);
  });

  it('marks the initial baseline as backup-only instead of pretending rollback is safe', async () => {
    const migration = new InitialSchemaBaseline1784770000000();

    await expect(migration.down()).rejects.toThrow(
      'Restore from a database backup instead.',
    );
  });
});
