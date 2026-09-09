import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { EntityManager, Repository } from 'typeorm';

import { ErrorCode } from '../../../../src/common/error-codes';
import { RoomType } from '../../../../src/module/room-type/schema/room-type.entity';
import { AmenityService } from '../../../../src/module/amenity/amenity.service';
import { Amenity } from '../../../../src/module/amenity/schema/amenity.entity';

describe('AmenityService', () => {
  let repository: {
    createQueryBuilder: jest.Mock;
    findOneBy: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    softRemove: jest.Mock;
    recover: jest.Mock;
    manager: {
      transaction: jest.Mock;
    };
  };
  let txAmenityRepo: {
    createQueryBuilder: jest.Mock;
    save: jest.Mock;
    softRemove: jest.Mock;
  };
  let txRoomTypeRepo: {
    createQueryBuilder: jest.Mock;
  };
  let transactionManager: {
    getRepository: jest.Mock;
  };
  let service: AmenityService;

  beforeEach(() => {
    txAmenityRepo = {
      createQueryBuilder: jest.fn(),
      save: jest.fn((value: Amenity) => Promise.resolve(amenityFixture(value))),
      softRemove: jest.fn((value: Amenity) =>
        Promise.resolve({ ...value, deletedAt: new Date('2026-02-01') }),
      ),
    };
    txRoomTypeRepo = {
      createQueryBuilder: jest.fn(),
    };
    transactionManager = {
      getRepository: jest.fn((entity: unknown) =>
        entity === Amenity ? txAmenityRepo : txRoomTypeRepo,
      ),
    };
    repository = {
      createQueryBuilder: jest.fn(),
      findOneBy: jest.fn(),
      create: jest.fn((value: Amenity) => value),
      save: jest.fn((value: Amenity) => Promise.resolve(amenityFixture(value))),
      softRemove: jest.fn((value: Amenity) =>
        Promise.resolve({ ...value, deletedAt: new Date('2026-02-01') }),
      ),
      recover: jest.fn((value: Amenity) =>
        Promise.resolve({ ...value, deletedAt: null }),
      ),
      manager: {
        transaction: jest.fn(
          (work: (manager: EntityManager) => Promise<unknown>) =>
            work(transactionManager as unknown as EntityManager),
        ),
      },
    };
    service = new AmenityService(repository as unknown as Repository<Amenity>);
  });

  it('lists only active public amenities without deletedAt', async () => {
    const queryBuilder = createQueryBuilder({
      manyAndCount: [[amenityFixture()], 1],
    });
    repository.createQueryBuilder.mockReturnValue(queryBuilder);

    await expect(
      service.listPublic({ search: ' WIFI ', page: '1', limit: '10' }),
    ).resolves.toEqual({
      items: [
        {
          id: '1',
          name: 'Wi-Fi',
          description: 'Internet',
          createdAt: new Date('2026-01-01'),
          updatedAt: new Date('2026-01-01'),
        },
      ],
      meta: {
        pagination: { page: 1, limit: 10, total: 1, totalPages: 1 },
      },
    });
    expect(queryBuilder.withDeleted).not.toHaveBeenCalled();
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('LOWER(amenity.name)'),
      { search: '%wifi%' },
    );
  });

  it('allows admin list to include deleted amenities explicitly', async () => {
    const queryBuilder = createQueryBuilder({
      manyAndCount: [
        [amenityFixture({ deletedAt: new Date('2026-02-01') })],
        1,
      ],
    });
    repository.createQueryBuilder.mockReturnValue(queryBuilder);

    await expect(
      service.listAdmin({ includeDeleted: 'true' }),
    ).resolves.toMatchObject({
      items: [{ id: '1', deletedAt: new Date('2026-02-01') }],
    });
    expect(queryBuilder.withDeleted).toHaveBeenCalled();
  });

  it('creates normalized data and protects names across soft deletes', async () => {
    repository.createQueryBuilder.mockReturnValue(createQueryBuilder());

    await expect(
      service.create({
        name: '  Wi-Fi  ',
        description: '  Internet  ',
      }),
    ).resolves.toMatchObject({
      name: 'Wi-Fi',
      description: 'Internet',
      deletedAt: null,
    });
    expect(repository.create).toHaveBeenCalledWith({
      name: 'Wi-Fi',
      description: 'Internet',
    });
  });

  it('rejects a duplicate name including a soft-deleted row', async () => {
    repository.createQueryBuilder.mockReturnValue(
      createQueryBuilder({ one: amenityFixture({ deletedAt: new Date() }) }),
    );

    await expect(service.create({ name: 'Wi-Fi' })).rejects.toHaveProperty(
      'response.errorCode',
      ErrorCode.AMENITY_NAME_ALREADY_EXISTS,
    );
  });

  it('updates fields but rejects an empty update', async () => {
    const amenity = amenityFixture();
    const lockQuery = createQueryBuilder({ one: amenity });
    txAmenityRepo.createQueryBuilder
      .mockReturnValueOnce(lockQuery)
      .mockReturnValueOnce(createQueryBuilder());

    await expect(
      service.update('1', { name: ' Wi-Fi 6 ', description: null }),
    ).resolves.toMatchObject({
      name: 'Wi-Fi 6',
      description: null,
    });
    expect(repository.manager.transaction).toHaveBeenCalledTimes(1);
    expect(lockQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(txAmenityRepo.save).toHaveBeenCalledWith(amenity);
    expect(repository.save).not.toHaveBeenCalled();
    await expect(service.update('1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('soft-deletes an unused active amenity under a pessimistic transaction lock', async () => {
    const amenity = amenityFixture();
    const amenityQuery = createQueryBuilder({ one: amenity });
    const roomTypeQuery = createQueryBuilder({ exists: false });
    txAmenityRepo.createQueryBuilder.mockReturnValue(amenityQuery);
    txRoomTypeRepo.createQueryBuilder.mockReturnValue(roomTypeQuery);

    await expect(service.softDelete('1')).resolves.toMatchObject({
      id: '1',
      deletedAt: new Date('2026-02-01'),
    });

    expect(repository.manager.transaction).toHaveBeenCalledTimes(1);
    expect(transactionManager.getRepository).toHaveBeenCalledWith(Amenity);
    expect(transactionManager.getRepository).toHaveBeenCalledWith(RoomType);
    expect(amenityQuery.withDeleted).toHaveBeenCalledTimes(1);
    expect(amenityQuery.where).toHaveBeenCalledWith('amenity.id = :id', {
      id: '1',
    });
    expect(amenityQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(txAmenityRepo.softRemove).toHaveBeenCalledWith(amenity);
    expect(repository.softRemove).not.toHaveBeenCalled();
  });

  it('refuses with AMENITY_IN_USE when an active RoomType references the amenity', async () => {
    const amenityQuery = createQueryBuilder({ one: amenityFixture() });
    const roomTypeQuery = createQueryBuilder({ exists: true });
    txAmenityRepo.createQueryBuilder.mockReturnValue(amenityQuery);
    txRoomTypeRepo.createQueryBuilder.mockReturnValue(roomTypeQuery);

    await expect(service.softDelete('1')).rejects.toMatchObject({
      response: {
        errorCode: ErrorCode.AMENITY_IN_USE,
        message: 'Khong the xoa tien nghi dang duoc loai phong su dung.',
      },
      status: 409,
    });
    expect(roomTypeQuery.innerJoin).toHaveBeenCalledWith(
      'roomType.amenities',
      'amenity',
      'amenity.id = :id',
      { id: '1' },
    );
    expect(roomTypeQuery.where).toHaveBeenCalledWith(
      'roomType.deletedAt IS NULL',
    );
    expect(txAmenityRepo.softRemove).not.toHaveBeenCalled();
    expect(repository.softRemove).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', null],
    ['soft-deleted', amenityFixture({ deletedAt: new Date('2026-02-01') })],
  ])(
    'rejects a %s amenity after locking and before checking relations or mutating',
    async (_label, lockedAmenity) => {
      const amenityQuery = createQueryBuilder({ one: lockedAmenity });
      txAmenityRepo.createQueryBuilder.mockReturnValue(amenityQuery);

      await expect(service.softDelete('1')).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(amenityQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
      expect(txRoomTypeRepo.createQueryBuilder).not.toHaveBeenCalled();
      expect(txAmenityRepo.softRemove).not.toHaveBeenCalled();
      expect(repository.softRemove).not.toHaveBeenCalled();
    },
  );

  it('rejects an invalid delete id before opening a transaction', async () => {
    await expect(service.softDelete('bad-id')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(repository.manager.transaction).not.toHaveBeenCalled();
    expect(txAmenityRepo.softRemove).not.toHaveBeenCalled();
  });

  it('restores a deleted amenity after checking name availability', async () => {
    const deleted = amenityFixture({ deletedAt: new Date('2026-02-01') });
    repository.createQueryBuilder
      .mockReturnValueOnce(createQueryBuilder({ one: deleted }))
      .mockReturnValueOnce(createQueryBuilder());

    await expect(service.restore('1')).resolves.toMatchObject({
      id: '1',
      deletedAt: null,
    });
    expect(repository.recover).toHaveBeenCalledWith(deleted);
  });

  it('rejects restoring an active amenity', async () => {
    repository.createQueryBuilder.mockReturnValue(
      createQueryBuilder({ one: amenityFixture() }),
    );

    await expect(service.restore('1')).rejects.toThrow(
      'Tien nghi chua bi xoa.',
    );
  });

  it('rejects invalid and missing ids for public detail', async () => {
    await expect(service.getPublic('bad-id')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    repository.findOneBy.mockResolvedValue(null);
    await expect(service.getPublic('999')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

interface QueryResult {
  exists?: boolean;
  one?: Amenity | null;
  manyAndCount?: [Amenity[], number];
}

function createQueryBuilder(result: QueryResult = {}) {
  const queryBuilder = {
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    skip: jest.fn(),
    take: jest.fn(),
    withDeleted: jest.fn(),
    innerJoin: jest.fn(),
    andWhere: jest.fn(),
    where: jest.fn(),
    setLock: jest.fn(),
    getExists: jest.fn().mockResolvedValue(result.exists ?? false),
    getOne: jest.fn().mockResolvedValue(result.one ?? null),
    getManyAndCount: jest
      .fn()
      .mockResolvedValue(result.manyAndCount ?? [[], 0]),
  };

  for (const method of [
    queryBuilder.orderBy,
    queryBuilder.addOrderBy,
    queryBuilder.skip,
    queryBuilder.take,
    queryBuilder.withDeleted,
    queryBuilder.innerJoin,
    queryBuilder.andWhere,
    queryBuilder.where,
    queryBuilder.setLock,
  ]) {
    method.mockReturnValue(queryBuilder);
  }

  return queryBuilder;
}

function amenityFixture(overrides: Partial<Amenity> = {}): Amenity {
  return {
    id: '1',
    name: 'Wi-Fi',
    description: 'Internet',
    roomTypes: [],
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    deletedAt: null,
    ...overrides,
  };
}
