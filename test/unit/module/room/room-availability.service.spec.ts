import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { type DataSource, type EntityManager, QueryFailedError } from 'typeorm';

import {
  RoomCalendar,
  RoomCalendarStatus,
} from '../../../../src/module/booking/schema/room-calendar.entity';
import { RoomAvailabilityService } from '../../../../src/module/room/room-availability.service';
import { Room } from '../../../../src/module/room/schema/room.entity';

describe('RoomAvailabilityService', () => {
  let roomResult: Room | null;
  let insert: jest.Mock;
  let deleteExecute: jest.Mock;
  let calendarQuery: ReturnType<typeof createCalendarQuery>;
  let dataSource: {
    manager: EntityManager;
    getRepository: jest.Mock;
    transaction: jest.Mock;
  };
  let service: RoomAvailabilityService;

  beforeEach(() => {
    roomResult = { id: '1' } as Room;
    insert = jest.fn().mockResolvedValue({ identifiers: [] });
    deleteExecute = jest.fn().mockResolvedValue({ affected: 2 });
    calendarQuery = createCalendarQuery();
    const manager = createManager(
      () => roomResult,
      insert,
      deleteExecute,
      calendarQuery,
    );
    dataSource = {
      manager,
      getRepository: jest.fn(() => ({
        createQueryBuilder: () => calendarQuery,
      })),
      transaction: jest.fn((work: (entityManager: EntityManager) => unknown) =>
        Promise.resolve(work(manager)),
      ),
    };
    service = new RoomAvailabilityService(dataSource as unknown as DataSource);
  });

  it('lists reserved and blocked nights in an exclusive end range', async () => {
    calendarQuery.getMany.mockResolvedValue([
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
  });

  it('creates one BLOCKED row per night under a Room lock', async () => {
    calendarQuery.getMany.mockResolvedValue([
      calendarFixture(),
      calendarFixture({ id: '2', stayDate: '2030-01-02' }),
    ]);

    await service.block('1', {
      from: '2030-01-01',
      to: '2030-01-03',
      reason: ' Maintenance ',
    });

    expect(insert).toHaveBeenCalledWith([
      expect.objectContaining({
        roomId: '1',
        stayDate: '2030-01-01',
        status: RoomCalendarStatus.BLOCKED,
        reason: 'Maintenance',
      }),
      expect.objectContaining({ stayDate: '2030-01-02' }),
    ]);
  });

  it('maps a room-date unique collision to Conflict', async () => {
    insert.mockRejectedValue(
      new QueryFailedError('INSERT', [], {
        code: 'ER_DUP_ENTRY',
        message:
          "Duplicate entry '1-2030-01-01' for key 'room_calendar_room_date'",
      }),
    );

    await expect(
      service.block('1', {
        from: '2030-01-01',
        to: '2030-01-02',
        reason: 'Maintenance',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('unblocks only BLOCKED nights and preserves RESERVED rows', async () => {
    await expect(
      service.unblock('1', {
        from: '2030-01-01',
        to: '2030-01-03',
      }),
    ).resolves.toEqual({ removedCount: 2 });

    expect(calendarQuery.andWhere).toHaveBeenCalledWith('status = :status', {
      status: RoomCalendarStatus.BLOCKED,
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

  it('rejects a missing room before calendar mutation', async () => {
    roomResult = null;

    await expect(
      service.block('1', {
        from: '2030-01-01',
        to: '2030-01-02',
        reason: 'Maintenance',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(insert).not.toHaveBeenCalled();
  });
});

function createManager(
  getRoom: () => Room | null,
  insert: jest.Mock,
  deleteExecute: jest.Mock,
  calendarQuery: ReturnType<typeof createCalendarQuery>,
): EntityManager {
  const roomQuery = {
    where: jest.fn().mockReturnThis(),
    andWhere: jest.fn().mockReturnThis(),
    setLock: jest.fn().mockReturnThis(),
    getOne: jest.fn(() => Promise.resolve(getRoom())),
  };
  const calendarRepository = {
    create: jest.fn((value: RoomCalendar) => value),
    insert,
    createQueryBuilder: jest.fn(() => calendarQuery),
  };

  calendarQuery.execute.mockImplementation(deleteExecute);

  return {
    getRepository: jest.fn((entity: unknown) =>
      entity === Room
        ? { createQueryBuilder: () => roomQuery }
        : calendarRepository,
    ),
  } as unknown as EntityManager;
}

function createCalendarQuery() {
  const query = {
    leftJoinAndSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    delete: jest.fn(),
    from: jest.fn(),
    getMany: jest.fn().mockResolvedValue([]),
    execute: jest.fn(),
  };

  for (const method of [
    query.leftJoinAndSelect,
    query.where,
    query.andWhere,
    query.orderBy,
    query.delete,
    query.from,
  ]) {
    method.mockReturnValue(query);
  }

  return query;
}

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
    createdAt: new Date('2026-01-01'),
    ...overrides,
  };
}
