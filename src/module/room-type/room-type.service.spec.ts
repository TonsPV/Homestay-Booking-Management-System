import { BadRequestException, ConflictException } from '@nestjs/common';
import type { EntityManager, Repository } from 'typeorm';

import { Amenity } from '../amenity/schema/amenity.entity';
import { RoomTypeService } from './room-type.service';
import { RoomType } from './schema/room-type.entity';

describe('RoomTypeService', () => {
  let repository: {
    createQueryBuilder: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    softRemove: jest.Mock;
    recover: jest.Mock;
    manager: {
      transaction: jest.Mock;
      createQueryBuilder: jest.Mock;
    };
  };
  let service: RoomTypeService;

  beforeEach(() => {
    repository = {
      createQueryBuilder: jest.fn(),
      create: jest.fn((value: RoomType) => value),
      save: jest.fn((value: RoomType) =>
        Promise.resolve(roomTypeFixture(value)),
      ),
      softRemove: jest.fn((value: RoomType) =>
        Promise.resolve({ ...value, deletedAt: new Date('2026-02-01') }),
      ),
      recover: jest.fn((value: RoomType) =>
        Promise.resolve({ ...value, deletedAt: null }),
      ),
      manager: {
        transaction: jest.fn(),
        createQueryBuilder: jest.fn(),
      },
    };
    service = new RoomTypeService(
      repository as unknown as Repository<RoomType>,
    );
  });

  it('creates a normalized RoomType within documented boundaries', async () => {
    repository.createQueryBuilder.mockReturnValue(createQueryBuilder());

    await expect(
      service.create({
        name: '  Deluxe ',
        description: '  Sea view ',
        bedType: '  1 giuong doi ',
        maxGuests: 100,
        basePrice: '1250000.5',
      }),
    ).resolves.toMatchObject({
      name: 'Deluxe',
      description: 'Sea view',
      bedType: '1 giuong doi',
      maxGuests: 100,
      basePrice: '1250000.50',
      deletedAt: null,
    });
  });

  it.each([
    { maxGuests: 0, basePrice: '100000' },
    { maxGuests: 101, basePrice: '100000' },
    { maxGuests: 2, basePrice: '-1' },
    { maxGuests: 2, basePrice: '1.999' },
  ])('rejects invalid guest/price boundaries on create', async (body) => {
    await expect(
      service.create({ name: 'Invalid', ...body }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects maxGuests above 100 and empty updates', async () => {
    repository.createQueryBuilder.mockReturnValue(
      createQueryBuilder({ one: roomTypeFixture() }),
    );

    await expect(
      service.update('1', { maxGuests: 101 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.update('1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('keeps deleted RoomTypes out of public responses and exposes them to admin', async () => {
    const deleted = roomTypeFixture({ deletedAt: new Date('2026-02-01') });
    repository.createQueryBuilder
      .mockReturnValueOnce(createQueryBuilder())
      .mockReturnValueOnce(createQueryBuilder({ one: deleted }));

    await expect(service.getPublic('1')).rejects.toThrow(
      'Khong tim thay loai phong.',
    );
    await expect(service.getAdmin('1')).resolves.toMatchObject({
      id: '1',
      deletedAt: new Date('2026-02-01'),
    });
  });

  it('refuses to delete a RoomType used by an active room', async () => {
    repository.createQueryBuilder.mockReturnValue(
      createQueryBuilder({ one: roomTypeFixture() }),
    );
    repository.manager.createQueryBuilder.mockReturnValue(
      createRawQueryBuilder({ id: 'room-1' }),
    );

    await expect(service.softDelete('1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(repository.softRemove).not.toHaveBeenCalled();
  });

  it('sets an exact sorted active Amenity set under a row lock', async () => {
    const roomType = roomTypeFixture();
    const roomTypeQuery = createQueryBuilder({ one: roomType });
    const roomTypeSave = jest.fn((value: RoomType) => Promise.resolve(value));
    const amenities = [
      amenityFixture({ id: '2', name: 'Wi-Fi' }),
      amenityFixture({ id: '1', name: 'Air conditioner' }),
    ];
    const manager = {
      getRepository: jest.fn((entity: unknown) =>
        entity === RoomType
          ? { createQueryBuilder: () => roomTypeQuery, save: roomTypeSave }
          : { findBy: () => Promise.resolve(amenities) },
      ),
    } as unknown as EntityManager;
    repository.manager.transaction.mockImplementation(
      (work: (entityManager: EntityManager) => unknown) =>
        Promise.resolve(work(manager)),
    );
    repository.createQueryBuilder.mockReturnValue(
      createQueryBuilder({ one: roomType }),
    );

    await service.setAmenities('1', { amenityIds: ['1', '2'] });

    expect(roomTypeQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(roomType.amenities.map((amenity) => amenity.id)).toEqual(['1', '2']);
    expect(roomTypeSave).toHaveBeenCalledWith(roomType);
  });

  it.each([
    undefined,
    '1',
    ['0'],
    ['1', '1'],
    Array.from({ length: 51 }, (_, index) => String(index + 1)),
  ])('rejects an invalid Amenity id set before transaction', async (ids) => {
    await expect(
      service.setAmenities('1', { amenityIds: ids }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.manager.transaction).not.toHaveBeenCalled();
  });
});

interface QueryResult {
  one?: RoomType | null;
}

function createQueryBuilder(result: QueryResult = {}) {
  const queryBuilder = {
    leftJoinAndSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    skip: jest.fn(),
    take: jest.fn(),
    withDeleted: jest.fn(),
    setLock: jest.fn(),
    getOne: jest.fn().mockResolvedValue(result.one ?? null),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
  };

  for (const method of [
    queryBuilder.leftJoinAndSelect,
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

function createRawQueryBuilder(result: { id: string } | null) {
  const queryBuilder = {
    select: jest.fn(),
    from: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    limit: jest.fn(),
    getRawOne: jest.fn().mockResolvedValue(result),
  };

  for (const method of [
    queryBuilder.select,
    queryBuilder.from,
    queryBuilder.where,
    queryBuilder.andWhere,
    queryBuilder.limit,
  ]) {
    method.mockReturnValue(queryBuilder);
  }

  return queryBuilder;
}

function roomTypeFixture(overrides: Partial<RoomType> = {}): RoomType {
  return {
    id: '1',
    name: 'Deluxe',
    description: 'Sea view',
    bedType: '1 giuong doi',
    maxGuests: 2,
    basePrice: '1250000.00',
    amenities: [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
    ...overrides,
  };
}

function amenityFixture(overrides: Partial<Amenity> = {}): Amenity {
  return {
    id: '1',
    name: 'Amenity',
    description: null,
    roomTypes: [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
    ...overrides,
  };
}
