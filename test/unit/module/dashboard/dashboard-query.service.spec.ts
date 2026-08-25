import type { DataSource, QueryRunner } from 'typeorm';

import { AddDashboardQueryIndexes1784782000000 } from '../../../../src/database/migrations/1784782000000-AddDashboardQueryIndexes';
import { DashboardQueryService } from '../../../../src/module/dashboard/dashboard-query.service';

describe('DashboardQueryService', () => {
  it('uses the documented inclusive range and separates collected/refunded', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([
        {
          pendingPayment: '1',
          confirmed: '2',
          checkedIn: '3',
          checkedOut: '4',
          cancelled: '5',
        },
      ])
      .mockResolvedValueOnce([
        { ready: '6', occupied: '7', cleaning: '8', maintenance: '9' },
      ])
      .mockResolvedValueOnce([{ vnpay: '100000', manual: '200000' }])
      .mockResolvedValueOnce([{ count: '50000' }])
      .mockResolvedValueOnce([{ requiresReview: '2', refundPending: '1' }])
      .mockResolvedValueOnce([
        { reserved: '3', blocked: '1', operationalRooms: '2' },
      ]);
    const service = new DashboardQueryService({
      query,
    } as unknown as DataSource);

    await expect(
      service.getSummary({ from: '2026-07-01', to: '2026-07-02' }),
    ).resolves.toMatchObject({
      fromDate: '2026-07-01',
      toDate: '2026-07-02',
      revenue: { vnpay: 100000, manual: 200000, total: 300000 },
      totalRefunded: 50000,
      occupancy: {
        roomNightsReserved: 3,
        roomNightsAvailable: 3,
        occupancyRate: 100,
      },
    });

    const calls = query.mock.calls as unknown as Array<[string, ...unknown[]]>;
    const bookingSql = calls[0]?.[0] ?? '';
    const roomSql = calls[1]?.[0] ?? '';
    const collectedSql = calls[2]?.[0] ?? '';
    const refundedSql = calls[3]?.[0] ?? '';
    const paymentMetricsSql = calls[4]?.[0] ?? '';
    const occupancySql = calls[5]?.[0] ?? '';

    expect(bookingSql).toContain('created_at');
    expect(bookingSql).toContain("'+07:00', '+00:00'");
    expect(roomSql).toContain('deleted_at IS NULL');
    expect(collectedSql).toContain("status = 'SUCCESS'");
    expect(collectedSql).toContain('paid_at');
    expect(refundedSql).toContain("status = 'REFUNDED'");
    expect(refundedSql).not.toContain('REFUND_PENDING');
    expect(paymentMetricsSql).toContain("status = 'REQUIRES_REVIEW'");
    expect(paymentMetricsSql).toContain("status = 'REFUND_PENDING'");
    expect(occupancySql).toContain("b.status <> 'CANCELLED'");
    expect(occupancySql).toContain("r.status <> 'HIDDEN'");
    expect(occupancySql).toContain("status <> 'HIDDEN'");
    expect(occupancySql).toContain('rc.stay_date BETWEEN ? AND ?');
  });

  it('accepts exactly 366 inclusive days and returns zeros for an empty system', async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const service = new DashboardQueryService({
      query,
    } as unknown as DataSource);

    await expect(
      service.getSummary({ from: '2025-01-01', to: '2026-01-01' }),
    ).resolves.toMatchObject({
      bookings: {
        pendingPayment: 0,
        confirmed: 0,
        checkedIn: 0,
        checkedOut: 0,
        cancelled: 0,
      },
      rooms: { ready: 0, occupied: 0, cleaning: 0, maintenance: 0 },
      revenue: { vnpay: 0, manual: 0, total: 0 },
      totalRefunded: 0,
      payments: { requiresReview: 0, refundPending: 0 },
      occupancy: {
        roomNightsReserved: 0,
        roomNightsAvailable: 0,
        occupancyRate: 0,
      },
    });
    expect(query).toHaveBeenCalledTimes(6);
  });

  it.each([
    [{ from: '2026-02-30', to: '2026-03-01' }, 'Ngay bat dau'],
    [{ from: '2026-07-02', to: '2026-07-01' }, 'Ngay bat dau phai'],
    [{ from: '2025-01-01', to: '2026-01-02' }, '366 ngay'],
  ])('rejects invalid date ranges before querying', async (input, message) => {
    const query = jest.fn();
    const service = new DashboardQueryService({
      query,
    } as unknown as DataSource);

    await expect(service.getSummary(input)).rejects.toThrow(message);
    expect(query).not.toHaveBeenCalled();
  });

  it('adds and removes indexes for every dashboard range predicate', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new AddDashboardQueryIndexes1784782000000();
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
});
