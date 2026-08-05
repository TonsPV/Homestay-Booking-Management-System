import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';

import {
  ROOM_IMAGE_MAX_FILE_SIZE,
  ROOM_IMAGE_MAX_EDGE,
} from '../../config/room-image-storage';
import {
  RoomImageStorageService,
  type UploadedRoomImageFile,
} from './room-image-storage.service';

describe('RoomImageStorageService', () => {
  let uploadDirectory: string;
  let service: RoomImageStorageService;

  beforeEach(async () => {
    uploadDirectory = await mkdtemp(join(tmpdir(), 'hbms-room-images-'));
    const configService = {
      get: jest.fn((key: string) =>
        key === 'ROOM_IMAGE_UPLOAD_DIR' ? uploadDirectory : undefined,
      ),
    } as unknown as ConfigService;

    service = new RoomImageStorageService(configService);
  });

  afterEach(async () => {
    await rm(uploadDirectory, { force: true, recursive: true });
  });

  it('normalizes a valid upload to a managed WebP file', async () => {
    const input = await sharp({
      create: {
        width: 3200,
        height: 1800,
        channels: 3,
        background: '#336699',
      },
    })
      .png()
      .toBuffer();

    const imageUrl = await service.store('7', createUpload(input, 'image/png'));
    const fileName = imageUrl.split('/').at(-1);
    const output = await readFile(
      join(uploadDirectory, '7', fileName as string),
    );
    const metadata = await sharp(output).metadata();

    expect(imageUrl).toMatch(/^\/media\/room-images\/7\/[0-9a-f-]{36}\.webp$/);
    expect(metadata.format).toBe('webp');
    expect(Math.max(metadata.width ?? 0, metadata.height ?? 0)).toBe(
      ROOM_IMAGE_MAX_EDGE,
    );
  });

  it('creates a new versioned URL when an image is replaced', async () => {
    const firstUrl = await service.store(
      '7',
      createUpload(await createPng(), 'image/png'),
    );
    const secondUrl = await service.store(
      '7',
      createUpload(await createPng(), 'image/png'),
    );

    expect(secondUrl).not.toBe(firstUrl);
    expect(secondUrl).toMatch(/^\/media\/room-images\/7\/[0-9a-f-]{36}\.webp$/);
  });

  it('rejects a declared MIME type that does not match the decoded image', async () => {
    const input = await createPng();

    await expect(
      service.store('7', createUpload(input, 'image/jpeg')),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects invalid bytes, invalid room ids, and inconsistent sizes', async () => {
    const input = await createPng();
    const inconsistentSize = createUpload(input, 'image/png');

    inconsistentSize.size += 1;

    await expect(
      service.store(
        '7',
        createUpload(Buffer.from('not-an-image'), 'image/png'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.store('../7', createUpload(input, 'image/png')),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.store('7', inconsistentSize)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      service.store(
        '7',
        createUpload(Buffer.alloc(ROOM_IMAGE_MAX_FILE_SIZE + 1), 'image/png'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deletes managed files and ignores external URLs', async () => {
    const input = await createPng();
    const imageUrl = await service.store('7', createUpload(input, 'image/png'));
    const filePath = join(
      uploadDirectory,
      '7',
      imageUrl.split('/').at(-1) as string,
    );

    await service.deleteManaged('https://cdn.example.com/legacy.jpg');
    await expect(access(filePath)).resolves.toBeUndefined();

    await service.deleteManaged(imageUrl);
    await expect(access(filePath)).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(service.deleteManaged(imageUrl)).resolves.toBeUndefined();
  });
});

async function createPng(): Promise<Buffer> {
  return sharp({
    create: {
      width: 10,
      height: 10,
      channels: 3,
      background: '#ffffff',
    },
  })
    .png()
    .toBuffer();
}

function createUpload(buffer: Buffer, mimetype: string): UploadedRoomImageFile {
  return {
    buffer,
    mimetype,
    originalname: 'ignored-name.png',
    size: buffer.length,
  };
}
