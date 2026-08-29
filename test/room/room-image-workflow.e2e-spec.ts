import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { DataSource, type Repository } from 'typeorm';
import request from 'supertest';
import type { App } from 'supertest/types';
import sharp from 'sharp';

import { AppModule } from '../../src/app.module';
import { configureApp } from '../../src/bootstrap/configure-app';
import { ROOM_IMAGE_MAX_FILE_SIZE } from '../../src/config/room-image-storage';
import migrationDataSource from '../../src/database/data-source';
import { AccessTokenService } from '../../src/module/auth/access-token.service';
import { PasswordHasherService } from '../../src/module/auth/password-hasher.service';
import { RoomImageStorageService } from '../../src/module/room/room-image-storage.service';
import { RoomImage } from '../../src/module/room/schema/room-image.entity';
import { Room } from '../../src/module/room/schema/room.entity';
import { RoomStatus } from '../../src/module/room/domain/room-status';
import { RoomType } from '../../src/module/room-type/schema/room-type.entity';
import { User } from '../../src/module/user/schema/user.entity';
import { E2eHarness } from '../e2e-harness';

const PASSWORD = 'StrongPassword123!';

interface Envelope<T> {
  data: T;
}

interface ImagePayload {
  id: string;
  imageUrl: string;
  sortOrder: number;
  isCover: boolean;
}

describe('Room image/storage workflow (e2e)', () => {
  let app: INestApplication<App>;
  let harness: E2eHarness | undefined;
  let dataSource: DataSource;
  let rooms: Repository<Room>;
  let roomTypes: Repository<RoomType>;
  let images: Repository<RoomImage>;
  let users: Repository<User>;
  let hasher: PasswordHasherService;
  let accessTokens: AccessTokenService;
  let storage: RoomImageStorageService;
  let adminToken: string;
  let staffToken: string;
  const suffix = E2eHarness.createUniqueSuffix();
  const roomIds: string[] = [];
  const roomTypeIds: string[] = [];
  const imageIds: string[] = [];
  const imageUrls: string[] = [];
  const userIds: string[] = [];
  let sequence = 0;

  beforeAll(async () => {
    harness = new E2eHarness(migrationDataSource);
    await harness.initialize();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();

    dataSource = app.get(DataSource);
    rooms = dataSource.getRepository(Room);
    roomTypes = dataSource.getRepository(RoomType);
    images = dataSource.getRepository(RoomImage);
    users = dataSource.getRepository(User);
    hasher = app.get(PasswordHasherService);
    accessTokens = app.get(AccessTokenService);
    storage = app.get(RoomImageStorageService);

    const admin = await createUser('ADMIN');
    const staff = await createUser('STAFF');
    adminToken = signUser(admin);
    staffToken = signUser(staff);

    harness.registerCleanup(async () => {
      for (const imageUrl of imageUrls) await storage.deleteManaged(imageUrl);
      if (imageIds.length > 0) await images.delete([...new Set(imageIds)]);
      if (roomIds.length > 0) await rooms.delete([...new Set(roomIds)]);
      if (roomTypeIds.length > 0)
        await roomTypes.delete([...new Set(roomTypeIds)]);
      if (userIds.length > 0) await users.delete([...new Set(userIds)]);
    });
  });

  afterAll(async () => {
    try {
      await harness?.cleanup();
    } finally {
      await app?.close();
    }
  });

  it('validates image bytes/MIME, normalizes to WebP, and maintains one cover', async () => {
    const room = await createRoom();
    const png = await createPng(3200, 1800);

    await request(app.getHttpServer())
      .post(`/api/v1/rooms/${room.id}/images`)
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/rooms/${room.id}/images`)
      .set('Authorization', 'Bearer ' + adminToken)
      .attach('file', png, {
        filename: 'wrong-mime.png',
        contentType: 'image/jpeg',
      })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/rooms/${room.id}/images`)
      .set('Authorization', 'Bearer ' + adminToken)
      .attach('file', Buffer.from('not an image'), {
        filename: 'bad.png',
        contentType: 'image/png',
      })
      .expect(400);
    await request(app.getHttpServer())
      .post(`/api/v1/rooms/${room.id}/images`)
      .set('Authorization', 'Bearer ' + adminToken)
      .attach('file', Buffer.alloc(ROOM_IMAGE_MAX_FILE_SIZE + 1), {
        filename: 'too-large.png',
        contentType: 'image/png',
      })
      .expect(413);

    const first = await upload(room.id, png, 'first.png');
    expect(first.isCover).toBe(true);
    expect(first.imageUrl).toMatch(
      new RegExp(`^/media/room-images/${room.id}/[0-9a-f-]{36}\\.webp$`),
    );
    await request(app.getHttpServer())
      .get(first.imageUrl)
      .expect('Content-Type', /image\/webp/)
      .expect(200);

    const second = await upload(room.id, await createPng(), 'second.png');
    expect(second.isCover).toBe(false);
    await request(app.getHttpServer())
      .patch(`/api/v1/room-images/${second.id}/set-cover`)
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200);
    const coverCount = await images.countBy({ roomId: room.id, isCover: true });
    expect(coverCount).toBe(1);

    await request(app.getHttpServer())
      .delete(`/api/v1/room-images/${second.id}`)
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200);
    expect(await images.findOneByOrFail({ id: first.id })).toMatchObject({
      isCover: true,
    });
    await request(app.getHttpServer()).get(second.imageUrl).expect(404);
  });

  it('serializes concurrent first uploads and concurrent cover changes', async () => {
    const room = await createRoom();
    const png = await createPng();
    const firstUploads = await Promise.all([
      uploadResponse(room.id, png, 'concurrent-a.png'),
      uploadResponse(room.id, png, 'concurrent-b.png'),
    ]);
    expect(firstUploads.map((response) => response.status)).toEqual([201, 201]);
    const uploaded = firstUploads.map(
      (response) => response.body as Envelope<ImagePayload>,
    );
    const firstIds = uploaded.map((response) => response.data.id);
    const firstUrls = uploaded.map((response) => response.data.imageUrl);
    imageIds.push(...firstIds);
    imageUrls.push(...firstUrls);
    expect(await images.countBy({ roomId: room.id, isCover: true })).toBe(1);

    const coverResponses = await Promise.all(
      firstIds.map((id) =>
        request(app.getHttpServer())
          .patch(`/api/v1/room-images/${id}/set-cover`)
          .set('Authorization', 'Bearer ' + adminToken),
      ),
    );
    expect(coverResponses.map((response) => response.status)).toEqual([
      200, 200,
    ]);
    expect(await images.countBy({ roomId: room.id, isCover: true })).toBe(1);
  });

  it('keeps role boundaries and does not delete external image URLs as managed files', async () => {
    const room = await createRoom();
    const image = await images.save(
      images.create({
        roomId: room.id,
        imageUrl: 'https://cdn.example.com/room-external.jpg',
        sortOrder: 0,
        isCover: true,
      }),
    );
    imageIds.push(image.id);

    await request(app.getHttpServer())
      .post(`/api/v1/rooms/${room.id}/images`)
      .set('Authorization', 'Bearer ' + staffToken)
      .attach('file', await createPng(), {
        filename: 'staff.png',
        contentType: 'image/png',
      })
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/api/v1/room-images/${image.id}`)
      .set('Authorization', 'Bearer ' + staffToken)
      .expect(403);
    await request(app.getHttpServer())
      .delete(`/api/v1/room-images/${image.id}`)
      .set('Authorization', 'Bearer ' + adminToken)
      .expect(200);
    expect(await images.findOneBy({ id: image.id })).toBeNull();
  });

  async function upload(
    roomId: string,
    buffer: Buffer,
    filename: string,
  ): Promise<ImagePayload> {
    const response = await uploadResponse(roomId, buffer, filename);
    expect(response.status).toBe(201);
    const payload = (response.body as Envelope<ImagePayload>).data;
    imageIds.push(payload.id);
    imageUrls.push(payload.imageUrl);
    return payload;
  }

  function uploadResponse(roomId: string, buffer: Buffer, filename: string) {
    return request(app.getHttpServer())
      .post(`/api/v1/rooms/${roomId}/images`)
      .set('Authorization', 'Bearer ' + adminToken)
      .attach('file', buffer, { filename, contentType: 'image/png' });
  }

  async function createRoom(): Promise<Room> {
    const roomType = await roomTypes.save(
      roomTypes.create({
        name: 'Image ' + suffix + '-' + sequence,
        description: null,
        maxGuests: 2,
        basePrice: '100.00',
        amenities: [],
      }),
    );
    roomTypeIds.push(roomType.id);
    sequence += 1;
    const room = await rooms.save(
      rooms.create({
        roomTypeId: roomType.id,
        roomNumber: 'RI-' + suffix + '-' + sequence,
        name: 'Image room ' + sequence,
        description: null,
        status: RoomStatus.READY,
      }),
    );
    roomIds.push(room.id);
    return room;
  }

  async function createUser(role: 'ADMIN' | 'STAFF'): Promise<User> {
    const user = await users.save(
      users.create({
        fullName: 'Image ' + role,
        email: 'image-' + role.toLowerCase() + '-' + suffix + '@example.com',
        phone: null,
        passwordHash: await hasher.hash(PASSWORD),
        tokenVersion: 0,
        role,
        status: 'ACTIVE',
      }),
    );
    userIds.push(user.id);
    return user;
  }

  function signUser(user: User): string {
    return accessTokens.sign({
      actorType: 'user',
      userId: user.id,
      role: user.role,
      tokenVersion: user.tokenVersion,
    });
  }

  async function createPng(width = 10, height = 10): Promise<Buffer> {
    return sharp({
      create: { width, height, channels: 3, background: '#336699' },
    })
      .png()
      .toBuffer();
  }
});
