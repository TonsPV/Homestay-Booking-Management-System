import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type EntityManager, type Repository } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';

import { AppModule } from '../src/app.module';
import { configureApp, ErrorCode } from '../src/common/http';
import migrationDataSource from '../src/database/data-source';
import { AccessTokenService } from '../src/module/auth/access-token.service';
import { PasswordHasherService } from '../src/module/auth/password-hasher.service';
import { AmenityService } from '../src/module/amenity/amenity.service';
import { Amenity } from '../src/module/amenity/schema/amenity.entity';
import { RoomMutationService } from '../src/module/room/room-mutation.service';
import { RoomStatus, Room } from '../src/module/room/schema/room.entity';
import { BedType } from '../src/module/room-type/bed-configuration';
import { RoomTypeService } from '../src/module/room-type/room-type.service';
import { RoomType } from '../src/module/room-type/schema/room-type.entity';
import { User } from '../src/module/user/schema/user.entity';
import { E2eHarness } from './e2e-harness';

const PASSWORD = 'StrongPassword123!';

interface ResponseEnvelope<TData> {
  success: boolean;
  statusCode: number;
  message: string | string[];
  data: TData;
  meta?: { pagination: Record<string, number> };
}

interface ErrorEnvelope {
  errorCode: string;
}

interface RoomTypePayload {
  id: string;
  name: string;
  description: string | null;
  maxGuests: number;
  basePrice: string;
  bedType?: string | null;
  beds: Array<{ type: BedType; quantity: number }>;
  amenities: Array<{ id: string; name: string }>;
  deletedAt?: string | null;
}

interface RoomPayload {
  id: string;
  roomTypeId: string;
  roomNumber: string;
  name: string;
}

describe('RoomType workflow (e2e)', () => {
  let app: INestApplication<App>;
  let e2eHarness: E2eHarness | undefined;
  let dataSource: DataSource;
  let roomTypesRepository: Repository<RoomType>;
  let amenitiesRepository: Repository<Amenity>;
  let roomsRepository: Repository<Room>;
  let usersRepository: Repository<User>;
  let passwordHasher: PasswordHasherService;
  let accessTokenService: AccessTokenService;
  let admin: User;
  let adminToken: string;
  const createdRoomTypeIds: string[] = [];
  const createdAmenityIds: string[] = [];
  const createdRoomIds: string[] = [];
  const createdUserIds: string[] = [];
  const uniqueSuffix = E2eHarness.createUniqueSuffix();
  let fixtureSequence = 0;

  beforeAll(async () => {
    e2eHarness = new E2eHarness(migrationDataSource);
    await e2eHarness.initialize();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    dataSource = app.get(DataSource);
    roomTypesRepository = dataSource.getRepository(RoomType);
    amenitiesRepository = dataSource.getRepository(Amenity);
    roomsRepository = dataSource.getRepository(Room);
    usersRepository = dataSource.getRepository(User);
    passwordHasher = app.get(PasswordHasherService);
    accessTokenService = app.get(AccessTokenService);
    admin = await createAdmin();
    adminToken = tokenForUser(admin);

    e2eHarness.registerCleanup(async () => {
      if (createdRoomIds.length > 0) {
        await roomsRepository.delete([...new Set(createdRoomIds)]);
      }
      if (createdRoomTypeIds.length > 0) {
        await roomTypesRepository.delete([...new Set(createdRoomTypeIds)]);
      }
      if (createdAmenityIds.length > 0) {
        await amenitiesRepository.delete([...new Set(createdAmenityIds)]);
      }
      if (createdUserIds.length > 0) {
        await usersRepository.delete([...new Set(createdUserIds)]);
      }
    });
  });

  afterAll(async () => {
    try {
      if (e2eHarness !== undefined) {
        await e2eHarness.cleanup();
      }
    } finally {
      if (app !== undefined) {
        await app.close();
      }
    }
  });

  it('serves public/admin projections and validates RoomType fields', async () => {
    const name = nextName('base');
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/admin/room-types')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({
        name: '  ' + name + '  ',
        description: null,
        maxGuests: 4,
        basePrice: '125.50',
      })
      .expect(201);
    const body = createResponse.body as ResponseEnvelope<RoomTypePayload>;
    createdRoomTypeIds.push(body.data.id);
    expect(body.data).toMatchObject({
      name,
      description: null,
      maxGuests: 4,
      basePrice: '125.50',
      deletedAt: null,
      amenities: [],
      beds: [],
    });

    const publicResponse = await request(app.getHttpServer())
      .get('/api/v1/room-types/' + body.data.id)
      .expect(200);
    const publicBody = publicResponse.body as ResponseEnvelope<RoomTypePayload>;
    expect(publicBody.data).not.toHaveProperty('deletedAt');
    const adminDetail = await request(app.getHttpServer())
      .get('/api/v1/admin/room-types/' + body.data.id)
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200);
    expect(
      (adminDetail.body as ResponseEnvelope<RoomTypePayload>).data.deletedAt,
    ).toBeNull();

    await request(app.getHttpServer())
      .patch('/api/v1/admin/room-types/' + body.data.id)
      .set('Authorization', 'Bearer ' + adminToken)
      .send({})
      .expect(400);
    await request(app.getHttpServer())
      .patch('/api/v1/admin/room-types/' + body.data.id)
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ maxGuests: 101 })
      .expect(400);
    await request(app.getHttpServer())
      .patch('/api/v1/admin/room-types/' + body.data.id)
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ maxGuests: 0 })
      .expect(400);
  });

  it('creates, validates, updates, and returns normalized bed configurations', async () => {
    const createResponse = await request(app.getHttpServer())
      .post('/api/v1/admin/room-types')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({
        name: nextName('beds'),
        maxGuests: 4,
        basePrice: '300.00',
        beds: [
          { type: BedType.DOUBLE, quantity: 1 },
          { type: BedType.SINGLE, quantity: 2 },
        ],
      })
      .expect(201);
    const created = createResponse.body as ResponseEnvelope<RoomTypePayload>;
    createdRoomTypeIds.push(created.data.id);

    expect(created.data.beds).toEqual([
      { type: BedType.SINGLE, quantity: 2 },
      { type: BedType.DOUBLE, quantity: 1 },
    ]);
    expect(created.data.amenities).toEqual([]);

    await request(app.getHttpServer())
      .post('/api/v1/admin/room-types')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({
        name: nextName('invalid-beds'),
        maxGuests: 2,
        basePrice: '100.00',
        beds: [{ type: BedType.SINGLE, quantity: 0 }],
      })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/admin/room-types')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({
        name: nextName('duplicate-beds'),
        maxGuests: 2,
        basePrice: '100.00',
        beds: [
          { type: BedType.SINGLE, quantity: 1 },
          { type: BedType.SINGLE, quantity: 2 },
        ],
      })
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/v1/admin/room-types')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({
        name: nextName('ambiguous-beds'),
        maxGuests: 2,
        basePrice: '100.00',
        bedType: '1 giuong doi',
        beds: [{ type: BedType.DOUBLE, quantity: 1 }],
      })
      .expect(400);

    const updated = await request(app.getHttpServer())
      .patch('/api/v1/admin/room-types/' + created.data.id)
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ beds: [{ type: BedType.KING, quantity: 1 }] })
      .expect(200);
    expect(
      (updated.body as ResponseEnvelope<RoomTypePayload>).data.beds,
    ).toEqual([{ type: BedType.KING, quantity: 1 }]);

    const preserved = await request(app.getHttpServer())
      .patch('/api/v1/admin/room-types/' + created.data.id)
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ maxGuests: 5 })
      .expect(200);
    expect(
      (preserved.body as ResponseEnvelope<RoomTypePayload>).data.beds,
    ).toEqual([{ type: BedType.KING, quantity: 1 }]);

    const publicResponse = await request(app.getHttpServer())
      .get('/api/v1/room-types/' + created.data.id)
      .expect(200);
    expect(
      (publicResponse.body as ResponseEnvelope<RoomTypePayload>).data.beds,
    ).toEqual([{ type: BedType.KING, quantity: 1 }]);
  });

  it('sets exact active Amenity IDs, sorts the result, and rejects invalid sets', async () => {
    const first = await createAmenity('Zulu ' + uniqueSuffix);
    const second = await createAmenity('Alpha ' + uniqueSuffix);
    const roomType = await createRoomType(nextName('amenities'));

    const setResponse = await request(app.getHttpServer())
      .put('/api/v1/admin/room-types/' + roomType.id + '/amenities')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ amenityIds: [first.id, second.id] })
      .expect(200);
    const setBody = setResponse.body as ResponseEnvelope<RoomTypePayload>;
    expect(setBody.data.amenities.map((amenity) => amenity.name)).toEqual([
      'Alpha ' + uniqueSuffix,
      'Zulu ' + uniqueSuffix,
    ]);
    expect(setBody.data.beds).toEqual([]);

    await request(app.getHttpServer())
      .put('/api/v1/admin/room-types/' + roomType.id + '/amenities')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ amenityIds: [first.id, first.id] })
      .expect(400);
    await request(app.getHttpServer())
      .put('/api/v1/admin/room-types/' + roomType.id + '/amenities')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ amenityIds: ['999999999'] })
      .expect(400);
    await request(app.getHttpServer())
      .put('/api/v1/admin/room-types/' + roomType.id + '/amenities')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ amenityIds: [] })
      .expect(200);
  });

  it('soft-deletes/restores names and blocks deletion while an active Room exists', async () => {
    const roomType = await createRoomType(nextName('room-protection'));
    const room = await roomsRepository.save(
      roomsRepository.create({
        roomTypeId: roomType.id,
        roomNumber: 'RT-' + uniqueSuffix,
        name: 'RoomType protection room',
        description: null,
        status: RoomStatus.READY,
      }),
    );
    createdRoomIds.push(room.id);

    const inUseResponse = await request(app.getHttpServer())
      .delete('/api/v1/admin/room-types/' + roomType.id)
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(409);
    expect((inUseResponse.body as ErrorEnvelope).errorCode).toBe(
      ErrorCode.ROOM_TYPE_IN_USE,
    );
    await roomsRepository.softDelete(room.id);
    await request(app.getHttpServer())
      .delete('/api/v1/admin/room-types/' + roomType.id)
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200);
    await request(app.getHttpServer())
      .get('/api/v1/room-types/' + roomType.id)
      .expect(404);
    await request(app.getHttpServer())
      .patch('/api/v1/admin/room-types/' + roomType.id + '/restore')
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200);
    await request(app.getHttpServer())
      .patch('/api/v1/admin/room-types/' + roomType.id + '/restore')
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(400);
  });

  it('rejects Room creation after the RoomType was soft-deleted', async () => {
    const roomType = await createRoomType(nextName('deleted-create'));

    await request(app.getHttpServer())
      .delete('/api/v1/admin/room-types/' + roomType.id)
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/v1/rooms')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({
        roomTypeId: roomType.id,
        roomNumber: 'RT-DELETED-' + uniqueSuffix,
        name: 'Deleted RoomType room',
      })
      .expect(404);

    await expect(
      roomsRepository.count({ where: { roomTypeId: roomType.id } }),
    ).resolves.toBe(0);
  });

  it('updates a Room to an active RoomType and rejects a deleted target', async () => {
    const sourceRoomType = await createRoomType(nextName('patch-source'));
    const activeTarget = await createRoomType(nextName('patch-active-target'));
    const room = await roomsRepository.save(
      roomsRepository.create({
        roomTypeId: sourceRoomType.id,
        roomNumber: 'RT-PATCH-' + uniqueSuffix,
        name: 'Patch target room',
        description: null,
        status: RoomStatus.READY,
      }),
    );
    createdRoomIds.push(room.id);

    const updated = await request(app.getHttpServer())
      .patch('/api/v1/rooms/' + room.id)
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ roomTypeId: activeTarget.id })
      .expect(200);
    expect((updated.body as ResponseEnvelope<RoomPayload>).data).toMatchObject({
      id: room.id,
      roomTypeId: activeTarget.id,
    });

    const deletedTarget = await createRoomType(
      nextName('patch-deleted-target'),
    );
    await request(app.getHttpServer())
      .delete('/api/v1/admin/room-types/' + deletedTarget.id)
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200);
    await request(app.getHttpServer())
      .patch('/api/v1/rooms/' + room.id)
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ roomTypeId: deletedTarget.id })
      .expect(404);

    const persistedRoom = await roomsRepository.findOneByOrFail({
      id: room.id,
    });
    expect(persistedRoom.roomTypeId).toBe(activeTarget.id);
  });

  it('serializes Room PATCH against RoomType soft-delete in MySQL', async () => {
    const sourceRoomType = await createRoomType(nextName('patch-race-source'));
    const targetRoomType = await createRoomType(nextName('patch-race-target'));
    const room = await roomsRepository.save(
      roomsRepository.create({
        roomTypeId: sourceRoomType.id,
        roomNumber: 'RT-PATCH-RACE-' + uniqueSuffix,
        name: 'Patch race room',
        description: null,
        status: RoomStatus.READY,
      }),
    );
    createdRoomIds.push(room.id);

    const roomMutationService = app.get(RoomMutationService);
    const roomTypeService = app.get(RoomTypeService);
    const roomMutationInternals = roomMutationService as unknown as {
      getLockedActiveRoomType(
        manager: EntityManager,
        id: string,
      ): Promise<RoomType>;
    };
    const roomTypeInternals = roomTypeService as unknown as {
      getLockedActiveRoomTypeForMutation(
        manager: EntityManager,
        id: string,
      ): Promise<RoomType>;
    };
    const originalPatchLock =
      roomMutationInternals.getLockedActiveRoomType.bind(roomMutationInternals);
    const originalDeleteLock =
      roomTypeInternals.getLockedActiveRoomTypeForMutation.bind(
        roomTypeInternals,
      );
    const patchHasLock = createDeferred<void>();
    const deleteAttemptedLock = createDeferred<void>();
    const releasePatch = createDeferred<void>();
    const patchLockSpy = jest
      .spyOn(roomMutationInternals, 'getLockedActiveRoomType')
      .mockImplementation(async (manager, id) => {
        const locked = await originalPatchLock(manager, id);
        if (id === targetRoomType.id) {
          patchHasLock.resolve();
          await releasePatch.promise;
        }
        return locked;
      });
    const deleteLockSpy = jest
      .spyOn(roomTypeInternals, 'getLockedActiveRoomTypeForMutation')
      .mockImplementation(async (manager, id) => {
        if (id === targetRoomType.id) {
          deleteAttemptedLock.resolve();
        }
        return originalDeleteLock(manager, id);
      });
    let patchPromise: Promise<request.Response> | undefined;
    let deletePromise: Promise<request.Response> | undefined;

    try {
      patchPromise = request(app.getHttpServer())
        .patch('/api/v1/rooms/' + room.id)
        .set('Authorization', 'Bearer ' + adminToken)
        .send({ roomTypeId: targetRoomType.id })
        .then((response) => response);
      await waitForSignal(patchHasLock.promise, 'Room PATCH parent lock');

      deletePromise = request(app.getHttpServer())
        .delete('/api/v1/admin/room-types/' + targetRoomType.id)
        .set('Authorization', 'Bearer ' + adminToken)
        .then((response) => response);
      await waitForSignal(
        deleteAttemptedLock.promise,
        'RoomType delete lock attempt after PATCH',
      );
      releasePatch.resolve();

      const [patchResponse, deleteResponse] = await Promise.all([
        patchPromise,
        deletePromise,
      ]);
      expect([patchResponse.status, deleteResponse.status]).toEqual([200, 409]);
      expect((deleteResponse.body as ErrorEnvelope).errorCode).toBe(
        ErrorCode.ROOM_TYPE_IN_USE,
      );

      const persistedRoom = await roomsRepository.findOneByOrFail({
        id: room.id,
      });
      const persistedTarget = await roomTypesRepository
        .createQueryBuilder('roomType')
        .withDeleted()
        .where('roomType.id = :id', { id: targetRoomType.id })
        .getOneOrFail();
      expect(persistedRoom.roomTypeId).toBe(targetRoomType.id);
      expect(persistedTarget.deletedAt).toBeNull();
      expect(
        persistedRoom.deletedAt === null && persistedTarget.deletedAt !== null,
      ).toBe(false);
    } finally {
      releasePatch.resolve();
      await Promise.allSettled(
        [patchPromise, deletePromise].filter(
          (promise): promise is Promise<request.Response> =>
            promise !== undefined,
        ),
      );
      patchLockSpy.mockRestore();
      deleteLockSpy.mockRestore();
    }
  });

  it('restores RoomType with active Amenities and removes stale deleted-Amenity joins', async () => {
    const activeAmenity = await createAmenity(nextName('restore-active'));
    const staleAmenity = await createAmenity(nextName('restore-stale'));
    const roomType = await createRoomType(nextName('restore-stale-room-type'));

    await request(app.getHttpServer())
      .put('/api/v1/admin/room-types/' + roomType.id + '/amenities')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ amenityIds: [activeAmenity.id, staleAmenity.id] })
      .expect(200);
    await request(app.getHttpServer())
      .delete('/api/v1/admin/room-types/' + roomType.id)
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200);
    await request(app.getHttpServer())
      .delete('/api/v1/admin/amenities/' + staleAmenity.id)
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200);

    const restored = await request(app.getHttpServer())
      .patch('/api/v1/admin/room-types/' + roomType.id + '/restore')
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200);
    const restoredBody = restored.body as ResponseEnvelope<RoomTypePayload>;
    expect(restoredBody.data.deletedAt).toBeNull();
    expect(restoredBody.data.amenities.map((amenity) => amenity.id)).toEqual([
      activeAmenity.id,
    ]);
    expect(await countAmenityRelation(roomType.id, staleAmenity.id)).toBe(0);
    expect(await countAmenityRelation(roomType.id, activeAmenity.id)).toBe(1);

    const persistedStaleAmenity = await amenitiesRepository.findOne({
      where: { id: staleAmenity.id },
      withDeleted: true,
    });
    expect(persistedStaleAmenity?.deletedAt).toEqual(expect.any(Date));
  });

  it('restores a RoomType with all active Amenity relations unchanged', async () => {
    const firstAmenity = await createAmenity(nextName('restore-all-first'));
    const secondAmenity = await createAmenity(nextName('restore-all-second'));
    const roomType = await createRoomType(nextName('restore-all-room-type'));

    await request(app.getHttpServer())
      .put('/api/v1/admin/room-types/' + roomType.id + '/amenities')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ amenityIds: [firstAmenity.id, secondAmenity.id] })
      .expect(200);
    await request(app.getHttpServer())
      .delete('/api/v1/admin/room-types/' + roomType.id)
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200);

    const restored = await request(app.getHttpServer())
      .patch('/api/v1/admin/room-types/' + roomType.id + '/restore')
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200);
    expect(
      (restored.body as ResponseEnvelope<RoomTypePayload>).data.amenities.map(
        (amenity) => amenity.id,
      ),
    ).toEqual(expect.arrayContaining([firstAmenity.id, secondAmenity.id]));
    expect(await countAmenityRelation(roomType.id, firstAmenity.id)).toBe(1);
    expect(await countAmenityRelation(roomType.id, secondAmenity.id)).toBe(1);
  });

  it('serializes RoomType restore against Amenity soft-delete in MySQL', async () => {
    const amenity = await createAmenity(nextName('restore-race-amenity'));
    const roomType = await createRoomType(nextName('restore-race-room-type'));

    await request(app.getHttpServer())
      .put('/api/v1/admin/room-types/' + roomType.id + '/amenities')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ amenityIds: [amenity.id] })
      .expect(200);
    await request(app.getHttpServer())
      .delete('/api/v1/admin/room-types/' + roomType.id)
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200);

    const roomTypeService = app.get(RoomTypeService);
    const amenityService = app.get(AmenityService);
    const roomTypeInternals = roomTypeService as unknown as {
      getLockedAmenitiesIncludingDeleted(
        manager: EntityManager,
        amenityIds: string[],
      ): Promise<Amenity[]>;
    };
    const amenityInternals = amenityService as unknown as {
      getLockedActiveAmenity(
        manager: EntityManager,
        id: string,
      ): Promise<Amenity>;
    };
    const originalRestoreLock =
      roomTypeInternals.getLockedAmenitiesIncludingDeleted.bind(
        roomTypeInternals,
      );
    const originalDeleteLock =
      amenityInternals.getLockedActiveAmenity.bind(amenityInternals);
    const restoreHasLock = createDeferred<void>();
    const deleteAttemptedLock = createDeferred<void>();
    const releaseRestore = createDeferred<void>();
    const restoreLockSpy = jest
      .spyOn(roomTypeInternals, 'getLockedAmenitiesIncludingDeleted')
      .mockImplementation(async (manager, amenityIds) => {
        const locked = await originalRestoreLock(manager, amenityIds);
        if (amenityIds.includes(amenity.id)) {
          restoreHasLock.resolve();
          await releaseRestore.promise;
        }
        return locked;
      });
    const deleteLockSpy = jest
      .spyOn(amenityInternals, 'getLockedActiveAmenity')
      .mockImplementation(async (manager, id) => {
        if (id === amenity.id) {
          deleteAttemptedLock.resolve();
        }
        return originalDeleteLock(manager, id);
      });
    let restorePromise: Promise<request.Response> | undefined;
    let deletePromise: Promise<request.Response> | undefined;

    try {
      restorePromise = request(app.getHttpServer())
        .patch('/api/v1/admin/room-types/' + roomType.id + '/restore')
        .set('Authorization', 'Bearer ' + adminToken)
        .then((response) => response);
      await waitForSignal(
        restoreHasLock.promise,
        'RoomType restore Amenity lock',
      );

      deletePromise = request(app.getHttpServer())
        .delete('/api/v1/admin/amenities/' + amenity.id)
        .set('Authorization', 'Bearer ' + adminToken)
        .then((response) => response);
      await waitForSignal(
        deleteAttemptedLock.promise,
        'Amenity delete lock attempt during restore',
      );
      releaseRestore.resolve();

      const [restoreResponse, deleteResponse] = await Promise.all([
        restorePromise,
        deletePromise,
      ]);
      expect([restoreResponse.status, deleteResponse.status]).toEqual([
        200, 409,
      ]);
      expect((deleteResponse.body as ErrorEnvelope).errorCode).toBe(
        ErrorCode.AMENITY_IN_USE,
      );

      const persistedRoomType = await roomTypesRepository.findOneByOrFail({
        id: roomType.id,
      });
      const persistedAmenity = await amenitiesRepository.findOneByOrFail({
        id: amenity.id,
      });
      expect(persistedRoomType.deletedAt).toBeNull();
      expect(persistedAmenity.deletedAt).toBeNull();
      expect(await countAmenityRelation(roomType.id, amenity.id)).toBe(1);
    } finally {
      releaseRestore.resolve();
      await Promise.allSettled(
        [restorePromise, deletePromise].filter(
          (promise): promise is Promise<request.Response> =>
            promise !== undefined,
        ),
      );
      restoreLockSpy.mockRestore();
      deleteLockSpy.mockRestore();
    }
  });

  it('serializes Room creation against RoomType soft-delete in MySQL', async () => {
    const roomType = await createRoomType(nextName('create-delete-race'));
    const roomMutationService = app.get(RoomMutationService);
    const roomTypeService = app.get(RoomTypeService);
    const roomMutationInternals = roomMutationService as unknown as {
      getLockedActiveRoomType(
        manager: EntityManager,
        id: string,
      ): Promise<RoomType>;
    };
    const roomTypeInternals = roomTypeService as unknown as {
      getLockedActiveRoomTypeForMutation(
        manager: EntityManager,
        id: string,
      ): Promise<RoomType>;
    };
    const originalCreateLock =
      roomMutationInternals.getLockedActiveRoomType.bind(roomMutationInternals);
    const originalDeleteLock =
      roomTypeInternals.getLockedActiveRoomTypeForMutation.bind(
        roomTypeInternals,
      );
    const createHasLock = createDeferred<void>();
    const deleteAttemptedLock = createDeferred<void>();
    const releaseCreate = createDeferred<void>();
    const createLockSpy = jest
      .spyOn(roomMutationInternals, 'getLockedActiveRoomType')
      .mockImplementation(async (manager, id) => {
        const locked = await originalCreateLock(manager, id);
        if (id === roomType.id) {
          createHasLock.resolve();
          await releaseCreate.promise;
        }
        return locked;
      });
    const deleteLockSpy = jest
      .spyOn(roomTypeInternals, 'getLockedActiveRoomTypeForMutation')
      .mockImplementation(async (manager, id) => {
        if (id === roomType.id) {
          deleteAttemptedLock.resolve();
        }
        return originalDeleteLock(manager, id);
      });
    let createPromise: Promise<request.Response> | undefined;
    let deletePromise: Promise<request.Response> | undefined;

    try {
      createPromise = request(app.getHttpServer())
        .post('/api/v1/rooms')
        .set('Authorization', 'Bearer ' + adminToken)
        .send({
          roomTypeId: roomType.id,
          roomNumber: 'RT-RACE-' + uniqueSuffix,
          name: 'RoomType race room',
        })
        .then((response) => response);
      await waitForSignal(createHasLock.promise, 'Room create parent lock');

      deletePromise = request(app.getHttpServer())
        .delete('/api/v1/admin/room-types/' + roomType.id)
        .set('Authorization', 'Bearer ' + adminToken)
        .then((response) => response);
      await waitForSignal(
        deleteAttemptedLock.promise,
        'RoomType delete lock attempt',
      );
      releaseCreate.resolve();

      const [createResponse, deleteResponse] = await Promise.all([
        createPromise,
        deletePromise,
      ]);
      expect([createResponse.status, deleteResponse.status]).toEqual([
        201, 409,
      ]);
      expect((deleteResponse.body as ErrorEnvelope).errorCode).toBe(
        ErrorCode.ROOM_TYPE_IN_USE,
      );

      const createdRoomId = (
        createResponse.body as ResponseEnvelope<{ id: string }>
      ).data.id;
      createdRoomIds.push(createdRoomId);
      const persistedRoomType = await roomTypesRepository
        .createQueryBuilder('roomType')
        .withDeleted()
        .where('roomType.id = :id', { id: roomType.id })
        .getOneOrFail();
      const activeRoomCount = await roomsRepository
        .createQueryBuilder('room')
        .where('room.roomTypeId = :roomTypeId', { roomTypeId: roomType.id })
        .andWhere('room.deletedAt IS NULL')
        .getCount();

      expect(persistedRoomType.deletedAt).toBeNull();
      expect(activeRoomCount).toBe(1);
      expect(persistedRoomType.deletedAt !== null && activeRoomCount > 0).toBe(
        false,
      );
    } finally {
      releaseCreate.resolve();
      await Promise.allSettled(
        [createPromise, deletePromise].filter(
          (promise): promise is Promise<request.Response> =>
            promise !== undefined,
        ),
      );
      createLockSpy.mockRestore();
      deleteLockSpy.mockRestore();
    }
  });

  async function createAdmin(): Promise<User> {
    const user = await usersRepository.save(
      usersRepository.create({
        fullName: 'RoomType E2E Admin',
        email: nextEmail('admin'),
        phone: null,
        passwordHash: await passwordHasher.hash(PASSWORD),
        tokenVersion: 0,
        role: 'ADMIN',
        status: 'ACTIVE',
      }),
    );
    createdUserIds.push(user.id);
    return user;
  }

  async function createAmenity(name: string): Promise<Amenity> {
    const amenity = await amenitiesRepository.save(
      amenitiesRepository.create({ name, description: null }),
    );
    createdAmenityIds.push(amenity.id);
    return amenity;
  }

  async function createRoomType(name: string): Promise<RoomType> {
    const roomType = await roomTypesRepository.save(
      roomTypesRepository.create({
        name,
        description: null,
        maxGuests: 2,
        basePrice: '100.00',
        amenities: [],
      }),
    );
    createdRoomTypeIds.push(roomType.id);
    return roomType;
  }

  async function countAmenityRelation(
    roomTypeId: string,
    amenityId: string,
  ): Promise<number> {
    const rows = await dataSource.query<
      Array<{ relationCount: string | number }>
    >(
      'SELECT COUNT(*) AS relationCount FROM room_type_amenities WHERE room_type_id = ? AND amenity_id = ?',
      [roomTypeId, amenityId],
    );

    return Number(rows[0]?.relationCount ?? 0);
  }

  function tokenForUser(user: User): string {
    return accessTokenService.sign({
      actorType: 'user',
      userId: user.id,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });
  }

  function nextName(label: string): string {
    fixtureSequence += 1;
    return 'RoomType ' + label + ' ' + uniqueSuffix + ' ' + fixtureSequence;
  }

  function nextEmail(label: string): string {
    fixtureSequence += 1;
    return (
      'room-type-' +
      label +
      '-' +
      uniqueSuffix +
      '-' +
      fixtureSequence +
      '@example.com'
    );
  }
});

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T | PromiseLike<T>): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

async function waitForSignal(
  signal: Promise<void>,
  description: string,
): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      signal,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(description + ' timed out.')),
          5000,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) {
      clearTimeout(timer);
    }
  }
}
