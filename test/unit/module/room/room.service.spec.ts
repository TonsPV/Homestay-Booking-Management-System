import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { IsNull, type Repository } from 'typeorm';

import type { RoomImageStorageService } from '../../../../src/module/room/room-image-storage.service';
import { RoomMutationService } from '../../../../src/module/room/room-mutation.service';
import { RoomQueryService } from '../../../../src/module/room/room-query.service';
import { RoomService } from '../../../../src/module/room/room.service';
import { Room } from '../../../../src/module/room/schema/room.entity';
import { RoomStatus } from '../../../../src/module/room/domain/room-status';
import { RoomType } from '../../../../src/module/room-type/schema/room-type.entity';
import { RoomCalendar } from '../../../../src/module/booking/schema/room-calendar.entity';
import { RoomCalendarStatus } from '../../../../src/module/booking/domain/room-calendar-status';
import type { AuditActorContext } from '../../../../src/module/audit/audit-log.service';
import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
} from '../../../../src/module/audit/domain/audit-log';
import { Booking } from '../../../../src/module/booking/schema/booking.entity';
import { BookingStatus } from '../../../../src/module/booking/domain/booking-state';
import { BookingStayPolicy } from '../../../../src/module/booking/domain/booking-stay.policy';
import { RoomStatusTransitionPolicy } from '../../../../src/module/room/domain/room-status-transition.policy';
import { RoomTodayAvailabilityStatus } from '../../../../src/module/room/room.types';

describe('RoomService', () => {
  let roomRepo: {
    createQueryBuilder: jest.Mock;
    findOneBy: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    manager: {
      transaction: jest.Mock;
      createQueryBuilder: jest.Mock;
      getRepository: jest.Mock;
    };
  };
  let roomTypeRepo: {
    createQueryBuilder: jest.Mock;
    findOneBy: jest.Mock;
  };
  let calendarRepo: { createQueryBuilder: jest.Mock };
  let bookingRepo: { createQueryBuilder: jest.Mock };
  let auditLogService: { record: jest.Mock };
  let queryService: RoomQueryService;
  let service: RoomService;

  beforeEach(() => {
    roomRepo = {
      createQueryBuilder: jest.fn(),
      findOneBy: jest.fn(),
      create: jest.fn((value: Room) => value),
      save: jest.fn((value: Room) => Promise.resolve(roomFixture(value))),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      manager: {
        transaction: jest.fn(),
        createQueryBuilder: jest.fn(),
        getRepository: jest.fn(),
      },
    };
    bookingRepo = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValue(createBookingLockQueryBuilder()),
    };
    roomTypeRepo = {
      createQueryBuilder: jest.fn(),
      findOneBy: jest.fn(),
    };
    roomRepo.manager.getRepository.mockImplementation((entity: unknown) => {
      if (entity === Booking) {
        return bookingRepo;
      }

      if (entity === RoomType) {
        return roomTypeRepo;
      }

      return roomRepo;
    });
    roomRepo.manager.transaction.mockImplementation(
      (
        isolationOrOperation: string | ((manager: unknown) => unknown),
        transactionOperation?: (manager: unknown) => unknown,
      ) => {
        const operation =
          typeof isolationOrOperation === 'function'
            ? isolationOrOperation
            : transactionOperation;

        return operation?.(roomRepo.manager);
      },
    );
    calendarRepo = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValue(createCalendarQueryBuilder()),
    };
    auditLogService = {
      record: jest.fn().mockResolvedValue(undefined),
    };
    queryService = new RoomQueryService(
      roomRepo as unknown as Repository<Room>,
      calendarRepo as unknown as Repository<RoomCalendar>,
      new BookingStayPolicy(10_000),
    );
    const roomMutationService = new RoomMutationService(
      roomRepo as unknown as Repository<Room>,
      roomTypeRepo as unknown as Repository<RoomType>,
      { deleteManaged: jest.fn() } as unknown as RoomImageStorageService,
      queryService,
      new RoomStatusTransitionPolicy(),
      auditLogService,
    );
    service = new RoomService(queryService, roomMutationService);
  });

  it('keeps HIDDEN and MAINTENANCE inventory out of public list queries', async () => {
    const queryBuilder = createRoomQueryBuilder({
      manyAndCount: [[roomFixture()], 1],
    });
    roomRepo.createQueryBuilder.mockReturnValue(queryBuilder);

    await expect(
      service.list({ page: 1, limit: 10, search: 'Deluxe' }),
    ).resolves.toMatchObject({
      items: [{ id: '1', name: 'Deluxe 101' }],
      meta: {
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
      },
    });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'room.status NOT IN (:...hiddenStatuses)',
      {
        hiddenStatuses: [RoomStatus.HIDDEN, RoomStatus.MAINTENANCE],
      },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      '(LOWER(room.name) LIKE :search OR LOWER(room.description) LIKE :search)',
      { search: '%deluxe%' },
    );
    const result = await service.list({ page: 1, limit: 10 });

    expect(result.items[0]).not.toHaveProperty('roomNumber');
    expect(result.items[0]).not.toHaveProperty('status');
    expect(result.items[0]).not.toHaveProperty('createdAt');
    expect(result.items[0]).not.toHaveProperty('updatedAt');
  });

  it('keeps price descending as the primary search order', async () => {
    const queryBuilder = createRoomQueryBuilder({
      manyAndCount: [[roomFixture()], 1],
    });
    roomRepo.createQueryBuilder.mockReturnValue(queryBuilder);

    await queryService.search({
      checkIn: '2030-02-01',
      checkOut: '2030-02-02',
      guests: 1,
      sort: 'PRICE_DESC',
    });

    expect(queryBuilder.orderBy).toHaveBeenCalledWith(
      'roomType.basePrice',
      'DESC',
    );
    expect(queryBuilder.addOrderBy).not.toHaveBeenCalledWith(
      'roomType.basePrice',
      'ASC',
    );
  });

  it('orders popularity through a selected alias', async () => {
    const queryBuilder = createRoomQueryBuilder({
      manyAndCount: [[roomFixture()], 1],
    });
    roomRepo.createQueryBuilder.mockReturnValue(queryBuilder);

    await queryService.search({
      checkIn: '2030-02-01',
      checkOut: '2030-02-02',
      guests: 1,
      sort: 'POPULARITY',
    });

    expect(queryBuilder.addSelect).toHaveBeenCalledWith(
      expect.stringContaining('COUNT(*)'),
      'roomPopularity',
    );
    expect(queryBuilder.orderBy).toHaveBeenCalledWith('roomPopularity', 'DESC');
  });

  it('retains physical room and operational status in management responses', async () => {
    const queryBuilder = createRoomQueryBuilder({
      manyAndCount: [[roomFixture({ status: RoomStatus.OCCUPIED })], 1],
    });
    roomRepo.createQueryBuilder.mockReturnValue(queryBuilder);

    await expect(service.listManagement({})).resolves.toMatchObject({
      items: [
        {
          id: '1',
          roomNumber: 'A-101',
          status: RoomStatus.OCCUPIED,
        },
      ],
    });
  });

  it('reports booking-calendar availability without changing READY operational status', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2030-01-01T01:00:00.000Z'));
    const queryBuilder = createRoomQueryBuilder({
      manyAndCount: [[roomFixture({ status: RoomStatus.READY })], 1],
    });
    const calendarQueryBuilder = createCalendarQueryBuilder([
      calendarFixture({
        stayDate: '2030-01-01',
        status: RoomCalendarStatus.RESERVED,
      }),
    ]);
    roomRepo.createQueryBuilder.mockReturnValue(queryBuilder);
    calendarRepo.createQueryBuilder.mockReturnValue(calendarQueryBuilder);

    try {
      await expect(service.listManagement({})).resolves.toMatchObject({
        items: [
          {
            id: '1',
            status: RoomStatus.READY,
            calendarSummary: {
              asOfDate: '2030-01-01',
              todayStatus: RoomTodayAvailabilityStatus.RESERVED,
              nextEvent: {
                stayDate: '2030-01-01',
                status: RoomCalendarStatus.RESERVED,
                booking: {
                  id: '99',
                  bookingCode: 'BK-ROOM-99',
                  checkInDate: '2030-01-01',
                  checkOutDate: '2030-01-03',
                },
              },
            },
          },
        ],
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('lists bookable physical rooms without calendar conflicts', async () => {
    const queryBuilder = createRoomQueryBuilder({
      manyAndCount: [[roomFixture()], 1],
    });
    roomRepo.createQueryBuilder.mockReturnValue(queryBuilder);

    await expect(
      service.listAvailable({
        checkIn: '2030-01-01',
        checkOut: '2030-01-03',
        guests: 2,
        roomTypeId: '1',
        page: 1,
        limit: 12,
      }),
    ).resolves.toMatchObject({
      items: [
        {
          id: '1',
          roomNumber: 'A-101',
          status: RoomStatus.READY,
        },
      ],
      meta: {
        pagination: { page: 1, limit: 12, total: 1, totalPages: 1 },
      },
    });
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'room.status NOT IN (:...unbookableStatuses)',
      {
        unbookableStatuses: [RoomStatus.HIDDEN, RoomStatus.MAINTENANCE],
      },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'roomType.maxGuests >= :guests',
      { guests: 2 },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('NOT EXISTS'),
      { checkIn: '2030-01-01', checkOut: '2030-01-03' },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'room.roomTypeId = :roomTypeId',
      { roomTypeId: '1' },
    );
  });

  it('validates management room availability criteria before querying', async () => {
    await expect(
      service.listAvailable({
        checkIn: '2030-01-03',
        checkOut: '2030-01-02',
        guests: 2,
      }),
    ).rejects.toThrow('Ngay check-out phai sau');
    await expect(
      service.listAvailable({
        checkIn: '2030-01-01',
        checkOut: '2030-01-02',
        guests: 0,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(roomRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('validates search dates, price order and Amenity ids before querying', async () => {
    await expect(
      service.search({
        checkIn: '2026-02-30',
        checkOut: '2026-03-02',
        guests: 2,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.search({
        checkIn: '2030-01-03',
        checkOut: '2030-01-02',
        guests: 2,
      }),
    ).rejects.toThrow('Ngay check-out phai sau');
    await expect(
      service.search({
        checkIn: '2030-01-01',
        checkOut: '2030-01-02',
        guests: 2,
        minPrice: '200',
        maxPrice: '100',
      }),
    ).rejects.toThrow('Gia toi da');
    await expect(
      service.search({
        checkIn: '2030-01-01',
        checkOut: '2030-01-02',
        guests: 2,
        amenityIds: ['0'],
      }),
    ).rejects.toThrow('Danh sach tien nghi');
    expect(roomRepo.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('builds availability search for every selected active Amenity', async () => {
    const queryBuilder = createRoomQueryBuilder();
    roomRepo.createQueryBuilder.mockReturnValue(queryBuilder);

    await service.search({
      checkIn: '2030-01-01',
      checkOut: '2030-01-03',
      guests: 2,
      amenityIds: ['1', '2', '2'],
    });

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('HAVING COUNT(DISTINCT'),
      { amenityIds: ['1', '2'], amenityCount: 2 },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('NOT EXISTS'),
      { checkIn: '2030-01-01', checkOut: '2030-01-03' },
    );
  });

  it('applies the requested room search order', async () => {
    const queryBuilder = createRoomQueryBuilder();
    roomRepo.createQueryBuilder.mockReturnValue(queryBuilder);

    await service.search({
      checkIn: '2030-01-01',
      checkOut: '2030-01-03',
      guests: 2,
      sort: 'POPULARITY',
    });

    expect(queryBuilder.addSelect).toHaveBeenCalledWith(
      expect.stringContaining('SELECT COUNT(*) FROM bookings'),
      'roomPopularity',
    );
    expect(queryBuilder.orderBy).toHaveBeenCalledWith('roomPopularity', 'DESC');
  });

  it('creates a normalized READY room against an active RoomType', async () => {
    const roomTypeLockQuery = createRoomTypeLockQuery(roomTypeFixture());
    roomTypeRepo.createQueryBuilder.mockReturnValue(roomTypeLockQuery);
    roomRepo.createQueryBuilder
      .mockReturnValueOnce(createRoomQueryBuilder())
      .mockReturnValueOnce(createRoomQueryBuilder({ one: roomFixture() }));

    await expect(
      service.create({
        roomTypeId: '1',
        roomNumber: '  A-101 ',
        name: ' Deluxe 101 ',
        description: '  Sea view ',
      }),
    ).resolves.toMatchObject({
      roomNumber: 'A-101',
      name: 'Deluxe 101',
      description: 'Sea view',
      status: RoomStatus.READY,
    });
    expect(roomRepo.manager.transaction).toHaveBeenCalledTimes(1);
    expect(roomTypeLockQuery.withDeleted).toHaveBeenCalledTimes(1);
    expect(roomTypeLockQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(roomRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        roomTypeId: '1',
        roomNumber: 'A-101',
        name: 'Deluxe 101',
      }),
    );
    expect(roomRepo.save).toHaveBeenCalledTimes(1);
  });

  it('rejects creating a Room with a soft-deleted RoomType under the row lock', async () => {
    const roomTypeLockQuery = createRoomTypeLockQuery(
      roomTypeFixture({ deletedAt: new Date('2026-02-01') }),
    );
    roomTypeRepo.createQueryBuilder.mockReturnValue(roomTypeLockQuery);

    await expect(
      service.create({
        roomTypeId: '1',
        roomNumber: 'A-103',
        name: 'Deleted RoomType room',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(roomRepo.manager.transaction).toHaveBeenCalledTimes(1);
    expect(roomTypeLockQuery.withDeleted).toHaveBeenCalledTimes(1);
    expect(roomTypeLockQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(roomRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(roomRepo.create).not.toHaveBeenCalled();
    expect(roomRepo.save).not.toHaveBeenCalled();
  });

  it('does not create an OCCUPIED Room without a checked-in Booking', async () => {
    await expect(
      service.create({
        roomTypeId: '1',
        roomNumber: 'A-102',
        name: 'Invalid occupied Room',
        status: RoomStatus.OCCUPIED,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(roomRepo.manager.transaction).not.toHaveBeenCalled();
    expect(roomTypeRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(roomRepo.save).not.toHaveBeenCalled();
  });

  it('rejects an empty room update', async () => {
    roomRepo.findOneBy.mockResolvedValue(roomFixture());

    await expect(service.update('1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(roomRepo.save).not.toHaveBeenCalled();
  });

  it('updates roomTypeId under target RoomType then Room row locks', async () => {
    const targetRoomTypeQuery = createRoomTypeLockQuery(
      roomTypeFixture({ id: '2', name: 'Suite' }),
    );
    const roomQuery = createRoomQueryBuilder({
      one: roomFixture({ roomTypeId: '1' }),
    });
    const responseQuery = createRoomQueryBuilder({
      one: roomFixture({ roomTypeId: '2' }),
    });
    roomTypeRepo.createQueryBuilder.mockReturnValue(targetRoomTypeQuery);
    roomRepo.createQueryBuilder
      .mockReturnValueOnce(roomQuery)
      .mockReturnValueOnce(responseQuery);

    await expect(
      service.update('1', { roomTypeId: '2' }),
    ).resolves.toMatchObject({ roomTypeId: '2' });

    expect(roomRepo.manager.transaction).toHaveBeenCalledTimes(1);
    expect(targetRoomTypeQuery.withDeleted).toHaveBeenCalled();
    expect(targetRoomTypeQuery.setLock).toHaveBeenCalledWith(
      'pessimistic_write',
    );
    expect(roomQuery.withDeleted).toHaveBeenCalled();
    expect(roomQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(targetRoomTypeQuery.getOne.mock.invocationCallOrder[0]).toBeLessThan(
      roomQuery.getOne.mock.invocationCallOrder[0],
    );
    expect(roomRepo.update).toHaveBeenCalledWith(
      { id: '1', deletedAt: IsNull() },
      { roomTypeId: '2' },
    );
  });

  it('rejects updating a Room to a soft-deleted RoomType before Room mutation', async () => {
    const deletedRoomTypeQuery = createRoomTypeLockQuery(
      roomTypeFixture({ id: '2', deletedAt: new Date('2026-02-01') }),
    );
    roomTypeRepo.createQueryBuilder.mockReturnValue(deletedRoomTypeQuery);

    await expect(
      service.update('1', { roomTypeId: '2' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(roomRepo.manager.transaction).toHaveBeenCalledTimes(1);
    expect(deletedRoomTypeQuery.setLock).toHaveBeenCalledWith(
      'pessimistic_write',
    );
    expect(roomRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(roomRepo.update).not.toHaveBeenCalled();
  });

  it.each([
    {
      current: RoomStatus.READY,
      next: RoomStatus.HIDDEN,
      role: 'STAFF' as const,
    },
    {
      current: RoomStatus.HIDDEN,
      next: RoomStatus.READY,
      role: 'STAFF' as const,
    },
    {
      current: RoomStatus.READY,
      next: RoomStatus.CLEANING,
      role: undefined,
    },
  ])(
    'rejects unauthorized status transition $current -> $next for $role',
    async ({ current, next, role }) => {
      roomRepo.createQueryBuilder.mockReturnValue(
        createRoomQueryBuilder({ one: roomFixture({ status: current }) }),
      );

      await expect(
        service.updateStatus('1', { status: next }, role, auditContext()),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(roomRepo.update).not.toHaveBeenCalled();
    },
  );

  it('allows STAFF operational transitions and ADMIN HIDDEN transitions', async () => {
    const room = roomFixture();
    roomRepo.createQueryBuilder.mockReturnValue(
      createRoomQueryBuilder({ one: room }),
    );

    await service.updateStatus(
      '1',
      { status: RoomStatus.CLEANING },
      'STAFF',
      auditContext(),
    );
    expect(roomRepo.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: '1',
        status: RoomStatus.READY,
      }),
      { status: RoomStatus.CLEANING },
    );

    await service.updateStatus(
      '1',
      { status: RoomStatus.HIDDEN },
      'ADMIN',
      auditContext(),
    );
    expect(roomRepo.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: '1',
        status: RoomStatus.READY,
      }),
      { status: RoomStatus.HIDDEN },
    );
  });

  it('does not audit an idempotent same-state Room status request', async () => {
    roomRepo.createQueryBuilder.mockReturnValue(
      createRoomQueryBuilder({
        one: roomFixture({ status: RoomStatus.READY }),
      }),
    );

    await expect(
      service.updateStatus(
        '1',
        { status: RoomStatus.READY },
        'STAFF',
        auditContext(),
      ),
    ).resolves.toMatchObject({ id: '1', status: RoomStatus.READY });

    expect(roomRepo.update).not.toHaveBeenCalled();
    expect(auditLogService.record).not.toHaveBeenCalled();
  });

  it('audits a real Room status transition with the transaction manager', async () => {
    roomRepo.createQueryBuilder.mockReturnValue(
      createRoomQueryBuilder({
        one: roomFixture({ status: RoomStatus.READY }),
      }),
    );
    const context = auditContext();

    await service.updateStatus(
      '1',
      { status: RoomStatus.CLEANING },
      'STAFF',
      context,
    );

    expect(auditLogService.record).toHaveBeenCalledTimes(1);
    expect(auditLogService.record).toHaveBeenCalledWith(roomRepo.manager, {
      ...context,
      action: AuditAction.ROOM_STATUS_CHANGED,
      entityType: AuditEntityType.ROOM,
      entityId: '1',
      metadata: {
        fromStatus: RoomStatus.READY,
        toStatus: RoomStatus.CLEANING,
      },
    });
  });

  it('returns Conflict when another status transition wins the race', async () => {
    const room = roomFixture();
    roomRepo.createQueryBuilder.mockReturnValue(
      createRoomQueryBuilder({ one: room }),
    );
    roomRepo.update.mockResolvedValue({ affected: 0 });

    await expect(
      service.updateStatus(
        '1',
        { status: RoomStatus.CLEANING },
        'STAFF',
        auditContext(),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(roomRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '1',
        status: RoomStatus.READY,
      }),
      { status: RoomStatus.CLEANING },
    );
  });

  it('locks Booking candidates before Room and rejects leaving OCCUPIED during CHECKED_IN', async () => {
    const room = roomFixture({ status: RoomStatus.OCCUPIED });
    const lockOrder: string[] = [];
    const bookingQuery = createBookingLockQueryBuilder([
      {
        id: '100',
        status: BookingStatus.CHECKED_IN,
      } as Booking,
    ]);
    const roomQuery = createRoomQueryBuilder({ one: room });
    bookingQuery.setLock.mockImplementation(() => {
      lockOrder.push('booking');
      return bookingQuery;
    });
    roomQuery.setLock.mockImplementation(() => {
      lockOrder.push('room');
      return roomQuery;
    });
    bookingRepo.createQueryBuilder.mockReturnValue(bookingQuery);
    roomRepo.createQueryBuilder.mockReturnValue(roomQuery);

    await expect(
      service.updateStatus(
        '1',
        { status: RoomStatus.READY },
        'ADMIN',
        auditContext(),
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(lockOrder).toEqual(['booking', 'room']);
    expect(roomRepo.manager.transaction).toHaveBeenCalledWith(
      'READ COMMITTED',
      expect.any(Function),
    );
    expect(bookingQuery.andWhere).toHaveBeenCalledWith(
      'booking.status IN (:...statuses)',
      {
        statuses: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN],
      },
    );
    expect(roomRepo.update).not.toHaveBeenCalled();
  });

  it('allows an explicit repair from READY to OCCUPIED for a checked-in Booking', async () => {
    const room = roomFixture({ status: RoomStatus.READY });
    bookingRepo.createQueryBuilder.mockReturnValue(
      createBookingLockQueryBuilder([
        { id: '100', status: BookingStatus.CHECKED_IN } as Booking,
      ]),
    );
    roomRepo.createQueryBuilder.mockReturnValue(
      createRoomQueryBuilder({ one: room }),
    );

    await expect(
      service.updateStatus(
        '1',
        { status: RoomStatus.OCCUPIED },
        'ADMIN',
        auditContext(),
      ),
    ).resolves.toMatchObject({ id: '1' });
    expect(roomRepo.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: '1', status: RoomStatus.READY }),
      { status: RoomStatus.OCCUPIED },
    );
  });
});

interface RoomQueryResult {
  one?: Room | null;
  manyAndCount?: [Room[], number];
}

function createRoomQueryBuilder(result: RoomQueryResult = {}) {
  const queryBuilder = {
    innerJoinAndSelect: jest.fn(),
    leftJoinAndSelect: jest.fn(),
    addSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    skip: jest.fn(),
    take: jest.fn(),
    withDeleted: jest.fn(),
    setLock: jest.fn(),
    getOne: jest.fn().mockResolvedValue(result.one ?? null),
    getManyAndCount: jest
      .fn()
      .mockResolvedValue(result.manyAndCount ?? [[], 0]),
  };

  for (const method of [
    queryBuilder.innerJoinAndSelect,
    queryBuilder.leftJoinAndSelect,
    queryBuilder.addSelect,
    queryBuilder.where,
    queryBuilder.andWhere,
    queryBuilder.orderBy,
    queryBuilder.addOrderBy,
    queryBuilder.skip,
    queryBuilder.take,
    queryBuilder.withDeleted,
    queryBuilder.setLock,
  ]) {
    method.mockReturnValue(queryBuilder);
  }

  return queryBuilder;
}

function createRoomTypeLockQuery(roomType: RoomType | null) {
  const queryBuilder = {
    withDeleted: jest.fn(),
    where: jest.fn(),
    setLock: jest.fn(),
    getOne: jest.fn().mockResolvedValue(roomType),
  };

  for (const method of [
    queryBuilder.withDeleted,
    queryBuilder.where,
    queryBuilder.setLock,
  ]) {
    method.mockReturnValue(queryBuilder);
  }

  return queryBuilder;
}

function createBookingLockQueryBuilder(result: Booking[] = []) {
  const queryBuilder = {
    select: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    setLock: jest.fn(),
    getMany: jest.fn().mockResolvedValue(result),
  };

  for (const method of [
    queryBuilder.select,
    queryBuilder.where,
    queryBuilder.andWhere,
    queryBuilder.orderBy,
    queryBuilder.setLock,
  ]) {
    method.mockReturnValue(queryBuilder);
  }

  return queryBuilder;
}

function createCalendarQueryBuilder(result: RoomCalendar[] = []) {
  const queryBuilder = {
    leftJoinAndSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    getMany: jest.fn().mockResolvedValue(result),
  };

  for (const method of [
    queryBuilder.leftJoinAndSelect,
    queryBuilder.where,
    queryBuilder.andWhere,
    queryBuilder.orderBy,
    queryBuilder.addOrderBy,
  ]) {
    method.mockReturnValue(queryBuilder);
  }

  return queryBuilder;
}

function calendarFixture(overrides: Partial<RoomCalendar> = {}): RoomCalendar {
  return {
    id: '501',
    roomId: '1',
    room: roomFixture(),
    bookingId: '99',
    booking: {
      id: '99',
      bookingCode: 'BK-ROOM-99',
      checkInDate: '2030-01-01',
      checkOutDate: '2030-01-03',
    } as RoomCalendar['booking'],
    stayDate: '2030-01-01',
    status: RoomCalendarStatus.RESERVED,
    reason: null,
    ...overrides,
  };
}

function roomFixture(overrides: Partial<Room> = {}): Room {
  const roomType = roomTypeFixture();

  return {
    id: '1',
    roomTypeId: '1',
    roomType,
    roomNumber: 'A-101',
    name: 'Deluxe 101',
    description: 'Sea view',
    status: RoomStatus.READY,
    images: [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
    ...overrides,
  };
}

function roomTypeFixture(overrides: Partial<RoomType> = {}): RoomType {
  return {
    id: '1',
    name: 'Deluxe',
    description: null,
    bedType: '1 giuong doi',
    beds: [],
    maxGuests: 2,
    basePrice: '1000000.00',
    amenities: [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
    ...overrides,
  };
}

function auditContext(): AuditActorContext {
  return {
    actorType: AuditActorType.USER,
    actorId: '7',
    requestId: 'request-room-status',
  };
}
