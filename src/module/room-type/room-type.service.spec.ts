import { BadRequestException, HttpStatus } from '@nestjs/common';
import type { EntityManager, Repository } from 'typeorm';

import { ErrorCode } from '../../common/http';
import { Amenity } from '../amenity/schema/amenity.entity';
import { Room } from '../room/schema/room.entity';
import { RoomTypeService } from './room-type.service';
import { BedType } from './bed-configuration';
import { RoomType } from './schema/room-type.entity';
import { RoomTypeBed } from './schema/room-type-bed.entity';

describe('RoomTypeService', () => {
  let repository: {
    createQueryBuilder: jest.Mock;
    manager: {
      transaction: jest.Mock;
    };
  };
  let managerRoomTypeRepository: {
    create: jest.Mock;
    save: jest.Mock;
    softRemove: jest.Mock;
    recover: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let managerRoomTypeState: RoomType;
  let managerBedsRepository: {
    create: jest.Mock;
    save: jest.Mock;
    delete: jest.Mock;
  };
  let managerAmenitiesRepository: {
    createQueryBuilder: jest.Mock;
  };
  let managerRoomsRepository: {
    createQueryBuilder: jest.Mock;
  };
  let manager: {
    getRepository: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let service: RoomTypeService;

  beforeEach(() => {
    repository = {
      createQueryBuilder: jest.fn(),
      manager: {
        transaction: jest.fn(),
      },
    };
    managerRoomTypeState = roomTypeFixture();
    managerRoomTypeRepository = {
      create: jest.fn((value: Partial<RoomType>) => {
        managerRoomTypeState = roomTypeFixture({
          ...managerRoomTypeState,
          ...value,
          id: '1',
          amenities: value.amenities ?? [],
          beds: value.beds ?? [],
        });
        return managerRoomTypeState;
      }),
      save: jest.fn((value: RoomType) => {
        managerRoomTypeState = roomTypeFixture({
          ...managerRoomTypeState,
          ...value,
        });
        return Promise.resolve(managerRoomTypeState);
      }),
      softRemove: jest.fn((value: RoomType) => {
        managerRoomTypeState = roomTypeFixture({
          ...value,
          deletedAt: new Date('2026-02-01'),
        });
        return Promise.resolve(managerRoomTypeState);
      }),
      recover: jest.fn((value: RoomType) => {
        managerRoomTypeState = roomTypeFixture({
          ...value,
          deletedAt: null,
        });
        return Promise.resolve(managerRoomTypeState);
      }),
      createQueryBuilder: jest.fn(() =>
        createQueryBuilder({ one: managerRoomTypeState }),
      ),
    };
    managerBedsRepository = {
      create: jest.fn((value: Partial<RoomTypeBed>) => value),
      save: jest.fn((value: unknown) => Promise.resolve(value)),
      delete: jest.fn(() => Promise.resolve({ affected: 0 })),
    };
    managerAmenitiesRepository = {
      createQueryBuilder: jest.fn(() =>
        createQueryBuilder<Amenity>({ many: [] }),
      ),
    };
    managerRoomsRepository = {
      createQueryBuilder: jest.fn(() =>
        createQueryBuilder<Room>({ one: null }),
      ),
    };
    manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === RoomType) return managerRoomTypeRepository;
        if (entity === RoomTypeBed) return managerBedsRepository;
        if (entity === Amenity) return managerAmenitiesRepository;
        if (entity === Room) return managerRoomsRepository;

        throw new Error('Unexpected repository requested by RoomTypeService.');
      }),
      createQueryBuilder: jest.fn(),
    };
    repository.manager.transaction.mockImplementation(
      (work: (entityManager: EntityManager) => unknown) =>
        work(manager as unknown as EntityManager),
    );
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

  it('creates multiple normalized bed types and returns deterministic order', async () => {
    repository.createQueryBuilder.mockReturnValue(createQueryBuilder());
    managerRoomTypeRepository.createQueryBuilder.mockReturnValue(
      createQueryBuilder({
        one: roomTypeFixture({
          beds: [
            bedFixture({ bedType: BedType.DOUBLE }),
            bedFixture({ bedType: BedType.SINGLE }),
          ],
        }),
      }),
    );

    await expect(
      service.create({
        name: 'Family',
        maxGuests: 4,
        basePrice: '2500000',
        beds: [
          { type: BedType.DOUBLE, quantity: 1 },
          { type: BedType.SINGLE, quantity: 2 },
        ],
      }),
    ).resolves.toMatchObject({
      beds: [
        { type: BedType.SINGLE, quantity: 1 },
        { type: BedType.DOUBLE, quantity: 1 },
      ],
    });
    expect(managerBedsRepository.save).toHaveBeenCalled();
  });

  it.each([
    [{ type: BedType.SINGLE, quantity: 0 }],
    [{ type: BedType.SINGLE, quantity: -1 }],
    [{ type: 'INVALID', quantity: 1 }],
    [
      { type: BedType.SINGLE, quantity: 1 },
      { type: BedType.SINGLE, quantity: 2 },
    ],
  ])('rejects invalid normalized bed input', async (beds) => {
    await expect(
      service.create({
        name: 'Invalid beds',
        maxGuests: 2,
        basePrice: '100',
        beds,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.manager.transaction).not.toHaveBeenCalled();
  });

  it('rejects requests that send legacy and normalized bed fields together', async () => {
    await expect(
      service.create({
        name: 'Ambiguous beds',
        maxGuests: 2,
        basePrice: '100',
        bedType: '1 giuong doi',
        beds: [{ type: BedType.DOUBLE, quantity: 1 }],
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.manager.transaction).not.toHaveBeenCalled();
  });

  it('preserves beds when PATCH omits beds and replaces all rows when supplied', async () => {
    repository.createQueryBuilder.mockReturnValue(createQueryBuilder());
    const existingBeds = [bedFixture({ bedType: BedType.KING })];
    managerRoomTypeRepository.createQueryBuilder.mockReturnValue(
      createQueryBuilder({ one: roomTypeFixture({ beds: existingBeds }) }),
    );

    await service.update('1', { maxGuests: 3 });
    expect(managerBedsRepository.delete).not.toHaveBeenCalled();

    managerRoomTypeRepository.createQueryBuilder.mockReturnValue(
      createQueryBuilder({ one: roomTypeFixture({ beds: existingBeds }) }),
    );
    await service.update('1', {
      beds: [{ type: BedType.QUEEN, quantity: 2 }],
    });
    expect(managerBedsRepository.delete).toHaveBeenCalledWith({
      roomTypeId: '1',
    });
    expect(managerBedsRepository.save).toHaveBeenCalled();
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
    const roomTypeQuery = createQueryBuilder({ one: roomTypeFixture() });
    const roomQuery = createQueryBuilder<Room>({
      one: { id: 'room-1' } as Room,
    });
    managerRoomTypeRepository.createQueryBuilder.mockReturnValue(roomTypeQuery);
    managerRoomsRepository.createQueryBuilder.mockReturnValue(roomQuery);

    await expect(service.softDelete('1')).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
      response: { errorCode: ErrorCode.ROOM_TYPE_IN_USE },
    });
    expect(roomTypeQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(roomQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(managerRoomTypeRepository.softRemove).not.toHaveBeenCalled();
  });

  it('soft deletes an unused RoomType inside the locked transaction', async () => {
    const active = roomTypeFixture();
    const deleted = roomTypeFixture({
      deletedAt: new Date('2026-02-01'),
    });
    const roomTypeQuery = createQueryBuilder({ one: active });
    const roomQuery = createQueryBuilder<Room>({ one: null });
    managerRoomTypeRepository.createQueryBuilder.mockReturnValue(roomTypeQuery);
    managerRoomsRepository.createQueryBuilder.mockReturnValue(roomQuery);
    repository.createQueryBuilder.mockReturnValue(
      createQueryBuilder({ one: deleted }),
    );

    await expect(service.softDelete('1')).resolves.toMatchObject({
      id: '1',
      deletedAt: new Date('2026-02-01'),
    });
    expect(roomTypeQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(roomQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(managerRoomTypeRepository.softRemove).toHaveBeenCalledWith(active);
  });

  it('restores a RoomType and keeps all active Amenity relations', async () => {
    const deletedRoomType = roomTypeFixture({
      deletedAt: new Date('2026-02-01'),
    });
    const activeAmenities = [
      amenityFixture({ id: '1', name: 'Wi-Fi' }),
      amenityFixture({ id: '2', name: 'TV' }),
    ];
    const relationQuery = createRelationQueryBuilder(['1', '2']);
    const amenityQuery = createQueryBuilder<Amenity>({
      many: activeAmenities,
    });
    const roomTypeLockQuery = createQueryBuilder({ one: deletedRoomType });
    const nameQuery = createQueryBuilder({ one: null });
    manager.createQueryBuilder.mockReturnValueOnce(relationQuery);
    managerAmenitiesRepository.createQueryBuilder.mockReturnValue(amenityQuery);
    managerRoomTypeRepository.createQueryBuilder
      .mockReturnValueOnce(roomTypeLockQuery)
      .mockReturnValueOnce(nameQuery);
    repository.createQueryBuilder.mockReturnValue(
      createQueryBuilder({
        one: roomTypeFixture({ amenities: activeAmenities }),
      }),
    );

    await expect(service.restore('1')).resolves.toMatchObject({
      id: '1',
      deletedAt: null,
      amenities: [
        expect.objectContaining({ id: '1' }),
        expect.objectContaining({ id: '2' }),
      ],
    });

    expect(amenityQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(roomTypeLockQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(amenityQuery.getMany.mock.invocationCallOrder[0]).toBeLessThan(
      roomTypeLockQuery.getOne.mock.invocationCallOrder[0],
    );
    expect(managerRoomTypeRepository.recover).toHaveBeenCalledWith(
      deletedRoomType,
    );
  });

  it('removes stale deleted-Amenity joins without restoring the Amenity', async () => {
    const deletedRoomType = roomTypeFixture({
      deletedAt: new Date('2026-02-01'),
    });
    const activeAmenity = amenityFixture({ id: '1', name: 'Wi-Fi' });
    const deletedAmenity = amenityFixture({
      id: '2',
      name: 'Minibar',
      deletedAt: new Date('2026-02-02'),
    });
    const relationQuery = createRelationQueryBuilder(['2', '1']);
    const amenityQuery = createQueryBuilder<Amenity>({
      many: [activeAmenity, deletedAmenity],
    });
    const roomTypeLockQuery = createQueryBuilder({ one: deletedRoomType });
    const nameQuery = createQueryBuilder({ one: null });
    const removeRelationQuery = createDeleteQueryBuilder();
    manager.createQueryBuilder
      .mockReturnValueOnce(relationQuery)
      .mockReturnValueOnce(removeRelationQuery);
    managerAmenitiesRepository.createQueryBuilder.mockReturnValue(amenityQuery);
    managerRoomTypeRepository.createQueryBuilder
      .mockReturnValueOnce(roomTypeLockQuery)
      .mockReturnValueOnce(nameQuery);
    repository.createQueryBuilder.mockReturnValue(
      createQueryBuilder({
        one: roomTypeFixture({ amenities: [activeAmenity] }),
      }),
    );

    await expect(service.restore('1')).resolves.toMatchObject({
      id: '1',
      deletedAt: null,
      amenities: [expect.objectContaining({ id: '1' })],
    });

    expect(removeRelationQuery.where).toHaveBeenCalledWith(
      'room_type_id = :roomTypeId',
      { roomTypeId: '1' },
    );
    expect(removeRelationQuery.andWhere).toHaveBeenCalledWith(
      'amenity_id IN (:...amenityIds)',
      { amenityIds: ['2'] },
    );
    expect(removeRelationQuery.execute).toHaveBeenCalled();
    expect(managerRoomTypeRepository.recover).toHaveBeenCalledWith(
      deletedRoomType,
    );
    expect(deletedAmenity.deletedAt).toEqual(new Date('2026-02-02'));
  });

  it('locks Amenity IDs deterministically before locking and saving the RoomType', async () => {
    const roomType = roomTypeFixture();
    const roomTypeQuery = createQueryBuilder({ one: roomType });
    const amenities = [
      amenityFixture({ id: '2', name: 'Wi-Fi' }),
      amenityFixture({ id: '1', name: 'Air conditioner' }),
    ];
    const amenitiesQuery = createQueryBuilder<Amenity>({ many: amenities });
    managerAmenitiesRepository.createQueryBuilder.mockReturnValue(
      amenitiesQuery,
    );
    managerRoomTypeRepository.createQueryBuilder.mockReturnValue(roomTypeQuery);
    repository.createQueryBuilder.mockReturnValue(
      createQueryBuilder({ one: roomType }),
    );

    await service.setAmenities('1', { amenityIds: ['2', '1'] });

    expect(amenitiesQuery.where).toHaveBeenCalledWith(
      'amenity.id IN (:...amenityIds)',
      { amenityIds: ['1', '2'] },
    );
    expect(amenitiesQuery.orderBy).toHaveBeenCalledWith('amenity.id', 'ASC');
    expect(amenitiesQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(roomTypeQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(amenitiesQuery.getMany.mock.invocationCallOrder[0]).toBeLessThan(
      roomTypeQuery.getOne.mock.invocationCallOrder[0],
    );
    expect(roomType.amenities.map((amenity) => amenity.id)).toEqual(['1', '2']);
    expect(managerRoomTypeRepository.save).toHaveBeenCalledWith(roomType);
  });

  it('rejects a deleted Amenity before locking or saving the RoomType', async () => {
    const deletedAmenity = amenityFixture({
      id: '2',
      deletedAt: new Date('2026-02-01'),
    });
    const amenitiesQuery = createQueryBuilder<Amenity>({
      many: [deletedAmenity],
    });
    managerAmenitiesRepository.createQueryBuilder.mockReturnValue(
      amenitiesQuery,
    );

    await expect(
      service.setAmenities('1', { amenityIds: ['2'] }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(amenitiesQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(managerRoomTypeRepository.createQueryBuilder).not.toHaveBeenCalled();
    expect(managerRoomTypeRepository.save).not.toHaveBeenCalled();
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

interface QueryResult<TEntity> {
  one?: TEntity | null;
  many?: TEntity[];
  rawMany?: Array<Record<string, string | number>>;
}

function createQueryBuilder<TEntity = RoomType>(
  result: QueryResult<TEntity> = {},
) {
  const queryBuilder = {
    select: jest.fn(),
    leftJoinAndSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    skip: jest.fn(),
    take: jest.fn(),
    withDeleted: jest.fn(),
    setLock: jest.fn(),
    from: jest.fn(),
    delete: jest.fn(),
    execute: jest.fn().mockResolvedValue({ affected: 0 }),
    getOne: jest.fn().mockResolvedValue(result.one ?? null),
    getMany: jest.fn().mockResolvedValue(result.many ?? []),
    getRawMany: jest.fn().mockResolvedValue(result.rawMany ?? []),
    getManyAndCount: jest.fn().mockResolvedValue([[], 0]),
  };

  for (const method of [
    queryBuilder.select,
    queryBuilder.leftJoinAndSelect,
    queryBuilder.where,
    queryBuilder.andWhere,
    queryBuilder.orderBy,
    queryBuilder.addOrderBy,
    queryBuilder.skip,
    queryBuilder.take,
    queryBuilder.withDeleted,
    queryBuilder.setLock,
    queryBuilder.from,
    queryBuilder.delete,
  ]) {
    method.mockReturnValue(queryBuilder);
  }

  return queryBuilder;
}

function createRelationQueryBuilder(amenityIds: string[]) {
  return createQueryBuilder({
    rawMany: amenityIds.map((amenityId) => ({ amenityId })),
  });
}

function createDeleteQueryBuilder() {
  return createQueryBuilder();
}

function roomTypeFixture(overrides: Partial<RoomType> = {}): RoomType {
  return {
    id: '1',
    name: 'Deluxe',
    description: 'Sea view',
    bedType: '1 giuong doi',
    beds: [],
    maxGuests: 2,
    basePrice: '1250000.00',
    amenities: [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
    ...overrides,
  };
}

function bedFixture(overrides: Partial<RoomTypeBed> = {}): RoomTypeBed {
  return {
    id: '1',
    roomTypeId: '1',
    roomType: roomTypeFixture(),
    bedType: BedType.SINGLE,
    quantity: 1,
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
