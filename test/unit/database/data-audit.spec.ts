import type { DataSource } from 'typeorm';

import {
  assertReadOnlyQuery,
  DATA_AUDIT_CHECKS,
  runDataAudit,
} from '../../../src/database/data-audit';

describe('data audit', () => {
  it('runs only SELECT checks and reports violations', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([{ violationCount: '2' }])
      .mockResolvedValue([{ violationCount: 0 }]);

    const results = await runDataAudit({
      query,
    } as unknown as DataSource);

    expect(query).toHaveBeenCalledTimes(DATA_AUDIT_CHECKS.length);
    expect(
      query.mock.calls.every(([sql]) =>
        /^SELECT\s/.test(String(sql).trim().toUpperCase()),
      ),
    ).toBe(true);
    expect(results[0]).toMatchObject({
      check: { name: 'active-booking-calendar' },
      violationCount: 2,
    });
  });

  it('contains all invariants required by the project audit plan', () => {
    const names = DATA_AUDIT_CHECKS.map(({ name }) => name);

    expect(names).toEqual([
      'active-booking-calendar',
      'cancelled-booking-calendar',
      'single-success-payment',
      'positive-price',
      'payment-lineage',
      'booking-payment-status',
      'payment-refund-lineage',
      'room-occupancy',
      'room-image-cover',
      'room-type-amenity-orphan',
      'expired-booking',
      'expired-payment',
      'stale-refund',
    ]);
    expect(new Set(names).size).toBe(names.length);
  });

  it('rejects mutation statements even when they follow a SELECT', () => {
    expect(() =>
      assertReadOnlyQuery('SELECT COUNT(*) FROM bookings'),
    ).not.toThrow();
    expect(() => assertReadOnlyQuery('UPDATE bookings SET status = 1')).toThrow(
      'read-only SELECT',
    );
    expect(() => assertReadOnlyQuery('SELECT 1; DELETE FROM bookings')).toThrow(
      'must not mutate',
    );
  });

  it('rejects invalid database counts', async () => {
    const query = jest.fn().mockResolvedValue([{ violationCount: 'NaN' }]);

    await expect(
      runDataAudit({ query } as unknown as DataSource),
    ).rejects.toThrow('returned an invalid count');
  });
});
