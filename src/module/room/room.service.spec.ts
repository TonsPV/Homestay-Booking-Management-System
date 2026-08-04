import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import type { Repository } from 'typeorm';

import type { RoomImageStorageService } from './room-image-storage.service';
import { RoomMutationService } from './room-mutation.service';
import { RoomQueryService } from './room-query.service';
import { RoomService } from './room.service';
import { Room, RoomStatus } from './schema/room.entity';
import { RoomType } from '../room-type/schema/room-type.entity';
import {
  RoomCalendar,
  RoomCalendarStatus,
} from '../booking/schema/room-calendar.entity';
import { RoomTodayAvailabilityStatus } from './room.types';

describe('RoomService', () => {
  let roomsRepository: {
    createQueryBuilder: jest.Mock;
    findOneBy: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    update: jest.Mock;
    manager: { transaction: jest.Mock; createQueryBuilder: jest.Mock };
  };
  let roomTypesRepository: { findOneBy: jest.Mock };
  let roomCalendarsRepository: { createQueryBuilder: jest.Mock };
  let service: RoomService;

  beforeEach(() => {
    roomsRepository = {
      createQueryBuilder: jest.fn(),
      findOneBy: jest.fn(),
      create: jest.fn((value: Room) => value),
      save: jest.fn((value: Room) => Promise.resolve(roomFixture(value))),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      manager: {
        transaction: jest.fn(),
        createQueryBuilder: jest.fn(),
      },
    };
    roomTypesRepository = { findOneBy: jest.fn() };
    roomCalendarsRepository = {
      createQueryBuilder: jest
        .fn()
        .mockReturnValue(createCalendarQueryBuilder()),
    };
    const roomQueryService = new RoomQueryService(
      roomsRepository as unknown as Repository<Room>,
      roomCalendarsRepository as unknown as Repository<RoomCalendar>,
    );
    const roomMutationService = new RoomMutationService(
      roomsRepository as unknown as Repository<Room>,
      roomTypesRepository as unknown as Repository<RoomType>,
      { deleteManaged: jest.fn() } as unknown as RoomImageStorageService,
      roomQueryService,
    );
    service = new RoomService(roomQueryService, roomMutationService);
  });

  it('keeps HIDDEN and MAINTENANCE inventory out of public list queries', async () => {
    const queryBuilder = createRoomQueryBuilder({
      manyAndCount: [[roomFixture()], 1],
    });
    roomsRepository.createQueryBuilder.mockReturnValue(queryBuilder);

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

    expect(result.items[0]).toHaveProperty('roomNumber', 'A-101');
    expect(result.items[0]).not.toHaveProperty('status');
    expect(result.items[0]).not.toHaveProperty('createdAt');
    expect(result.items[0]).not.toHaveProperty('updatedAt');
  });

  it('retains physical room and operational status in management responses', async () => {
    const queryBuilder = createRoomQueryBuilder({
      manyAndCount: [[roomFixture({ status: RoomStatus.OCCUPIED })], 1],
    });
    roomsRepository.createQueryBuilder.mockReturnValue(queryBuilder);

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
    roomsRepository.createQueryBuilder.mockReturnValue(queryBuilder);
    roomCalendarsRepository.createQueryBuilder.mockReturnValue(
      calendarQueryBuilder,
    );

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
    roomsRepository.createQueryBuilder.mockReturnValue(queryBuilder);

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
    expect(roomsRepository.createQueryBuilder).not.toHaveBeenCalled();
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
    expect(roomsRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('builds availability search for every selected active Amenity', async () => {
    const queryBuilder = createRoomQueryBuilder();
    roomsRepository.createQueryBuilder.mockReturnValue(queryBuilder);

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
    roomsRepository.createQueryBuilder.mockReturnValue(queryBuilder);

    await service.search({
      checkIn: '2030-01-01',
      checkOut: '2030-01-03',
      guests: 2,
      sort: 'POPULARITY',
    });

    expect(queryBuilder.orderBy).toHaveBeenCalledWith(
      expect.stringContaining('SELECT COUNT(*) FROM bookings'),
      'DESC',
    );
  });

  it('creates a normalized READY room against an active RoomType', async () => {
    roomTypesRepository.findOneBy.mockResolvedValue(roomTypeFixture());
    roomsRepository.createQueryBuilder
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
  });

  it('rejects an empty room update', async () => {
    roomsRepository.findOneBy.mockResolvedValue(roomFixture());

    await expect(service.update('1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(roomsRepository.save).not.toHaveBeenCalled();
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
      roomsRepository.findOneBy.mockResolvedValue(
        roomFixture({ status: current }),
      );

      await expect(
        service.updateStatus('1', { status: next }, role),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(roomsRepository.update).not.toHaveBeenCalled();
    },
  );

  it('allows STAFF operational transitions and ADMIN HIDDEN transitions', async () => {
    const room = roomFixture();
    roomsRepository.findOneBy.mockResolvedValue(room);
    roomsRepository.createQueryBuilder.mockReturnValue(
      createRoomQueryBuilder({ one: room }),
    );

    await service.updateStatus('1', { status: RoomStatus.CLEANING }, 'STAFF');
    expect(roomsRepository.update).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        id: '1',
        status: RoomStatus.READY,
      }),
      { status: RoomStatus.CLEANING },
    );

    await service.updateStatus('1', { status: RoomStatus.HIDDEN }, 'ADMIN');
    expect(roomsRepository.update).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        id: '1',
        status: RoomStatus.READY,
      }),
      { status: RoomStatus.HIDDEN },
    );
  });

  it('returns Conflict when another status transition wins the race', async () => {
    const room = roomFixture();
    roomsRepository.findOneBy.mockResolvedValue(room);
    roomsRepository.update.mockResolvedValue({ affected: 0 });

    await expect(
      service.updateStatus('1', { status: RoomStatus.CLEANING }, 'STAFF'),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(roomsRepository.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: '1',
        status: RoomStatus.READY,
      }),
      { status: RoomStatus.CLEANING },
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
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    skip: jest.fn(),
    take: jest.fn(),
    withDeleted: jest.fn(),
    getOne: jest.fn().mockResolvedValue(result.one ?? null),
    getManyAndCount: jest
      .fn()
      .mockResolvedValue(result.manyAndCount ?? [[], 0]),
  };

  for (const method of [
    queryBuilder.innerJoinAndSelect,
    queryBuilder.leftJoinAndSelect,
    queryBuilder.where,
    queryBuilder.andWhere,
    queryBuilder.orderBy,
    queryBuilder.addOrderBy,
    queryBuilder.skip,
    queryBuilder.take,
    queryBuilder.withDeleted,
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
    maxGuests: 2,
    basePrice: '1000000.00',
    amenities: [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
    ...overrides,
  };
}
