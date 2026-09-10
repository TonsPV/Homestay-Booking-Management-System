import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';

import type { TransactionContext } from '../../../../src/common/database/transaction';
import { AuditActorType } from '../../../../src/module/audit/domain/audit-log';
import { RoomCalendarStatus } from '../../../../src/module/booking/domain/room-calendar-status';
import { RoomCalendar } from '../../../../src/module/booking/schema/room-calendar.entity';
import { RoomCalendarBlockConflictError } from '../../../../src/module/room/ports/room-calendar-management.store';
import { RoomAvailabilityService } from '../../../../src/module/room/room-availability.service';
import { Room } from '../../../../src/module/room/schema/room.entity';

describe('RoomAvailabilityService', () => {
  const actor = {
    actorType: AuditActorType.USER,
    actorId: '7',
    requestId: 'calendar-test',
  };
  let audit: { record: jest.Mock };
  const transaction = {} as TransactionContext;
  let transactions: { run: jest.Mock };
  let roomCalendar: {
    roomExists: jest.Mock;
    lockRoom: jest.Mock;
    listRange: jest.Mock;
    blockDates: jest.Mock;
    unblockDates: jest.Mock;
  };
  let service: RoomAvailabilityService;

  beforeEach(() => {
    audit = { record: jest.fn().mockResolvedValue(undefined) };
    transactions = {
      run: jest.fn((work: (context: TransactionContext) => Promise<unknown>) =>
        work(transaction),
      ),
    };
    roomCalendar = {
      roomExists: jest.fn().mockResolvedValue(true),
      lockRoom: jest.fn().mockResolvedValue(true),
      listRange: jest.fn().mockResolvedValue([]),
      blockDates: jest.fn().mockResolvedValue([]),
      unblockDates: jest.fn().mockResolvedValue(2),
    };
    service = new RoomAvailabilityService(transactions, roomCalendar, audit);
  });

  it('lists reserved and blocked nights in an exclusive end range', async () => {
    roomCalendar.listRange.mockResolvedValue([
      calendarFixture({
        bookingId: '9',
        status: RoomCalendarStatus.RESERVED,
        booking: { id: '9', bookingCode: 'BK-9' } as never,
      }),
      calendarFixture({
        id: '2',
        stayDate: '2030-01-02',
        status: RoomCalendarStatus.BLOCKED,
      }),
    ]);

    await expect(
      service.list('1', { from: '2030-01-01', to: '2030-01-03' }),
    ).resolves.toEqual([
      expect.objectContaining({
        stayDate: '2030-01-01',
        status: RoomCalendarStatus.RESERVED,
        booking: { id: '9', bookingCode: 'BK-9' },
      }),
      expect.objectContaining({
        stayDate: '2030-01-02',
        status: RoomCalendarStatus.BLOCKED,
        booking: null,
      }),
    ]);
    expect(roomCalendar.listRange).toHaveBeenCalledWith('1', {
      from: '2030-01-01',
      to: '2030-01-03',
    });
  });

  it('blocks one calendar entry per night in the same transaction', async () => {
    roomCalendar.blockDates.mockResolvedValue([
      calendarFixture(),
      calendarFixture({ id: '2', stayDate: '2030-01-02' }),
    ]);

    await service.block(
      '1',
      {
        from: '2030-01-01',
        to: '2030-01-03',
        reason: ' Maintenance ',
      },
      actor,
    );

    expect(roomCalendar.lockRoom).toHaveBeenCalledWith(transaction, '1');
    expect(roomCalendar.blockDates).toHaveBeenCalledWith(
      transaction,
      '1',
      ['2030-01-01', '2030-01-02'],
      'Maintenance',
      { from: '2030-01-01', to: '2030-01-03' },
    );
  });

  it('maps a semantic room-date collision to Conflict', async () => {
    roomCalendar.blockDates.mockRejectedValue(
      new RoomCalendarBlockConflictError(),
    );

    await expect(
      service.block(
        '1',
        {
          from: '2030-01-01',
          to: '2030-01-02',
          reason: 'Maintenance',
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('unblocks only the requested blocked date range', async () => {
    await expect(
      service.unblock(
        '1',
        {
          from: '2030-01-01',
          to: '2030-01-03',
        },
        actor,
      ),
    ).resolves.toEqual({ removedCount: 2 });

    expect(roomCalendar.unblockDates).toHaveBeenCalledWith(transaction, '1', {
      from: '2030-01-01',
      to: '2030-01-03',
    });
  });

  it.each([
    { from: '2030-02-30', to: '2030-03-02' },
    { from: '2030-01-02', to: '2030-01-02' },
    { from: '2030-01-02', to: '2031-01-04' },
  ])('rejects invalid or oversized calendar ranges', async (query) => {
    await expect(service.list('1', query)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('does not audit an unblock that removed no nights', async () => {
    roomCalendar.unblockDates.mockResolvedValue(0);
    await service.unblock('1', { from: '2030-01-01', to: '2030-01-03' }, actor);
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('rejects a missing room before calendar mutation', async () => {
    roomCalendar.lockRoom.mockResolvedValue(false);

    await expect(
      service.block(
        '1',
        {
          from: '2030-01-01',
          to: '2030-01-02',
          reason: 'Maintenance',
        },
        actor,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(roomCalendar.blockDates).not.toHaveBeenCalled();
  });
});

function calendarFixture(overrides: Partial<RoomCalendar> = {}): RoomCalendar {
  return {
    id: '1',
    roomId: '1',
    room: {} as Room,
    bookingId: null,
    booking: null,
    stayDate: '2030-01-01',
    status: RoomCalendarStatus.BLOCKED,
    reason: 'Maintenance',
    ...overrides,
  };
}
