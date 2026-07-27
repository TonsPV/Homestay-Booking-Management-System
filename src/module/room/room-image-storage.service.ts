import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import sharp from 'sharp';

import {
  ROOM_IMAGE_MAX_EDGE,
  ROOM_IMAGE_MAX_FILE_SIZE,
  ROOM_IMAGE_MAX_PIXELS,
  ROOM_IMAGE_PUBLIC_PATH,
  resolveRoomImageUploadDirectory,
} from '../../config/room-image-storage';

export interface UploadedRoomImageFile {
  buffer: Buffer;
  mimetype: string;
  originalname: string;
  size: number;
}

const ALLOWED_FORMATS = new Map([
  ['jpeg', 'image/jpeg'],
  ['png', 'image/png'],
  ['webp', 'image/webp'],
]);
const MANAGED_IMAGE_PATH =
  /^\/media\/room-images\/([1-9][0-9]*)\/([0-9a-f-]{36}\.webp)$/;

@Injectable()
export class RoomImageStorageService {
  private readonly logger = new Logger(RoomImageStorageService.name);
  private readonly uploadDirectory: string;

  constructor(configService: ConfigService) {
    this.uploadDirectory = resolveRoomImageUploadDirectory(configService);
  }

  async store(roomId: string, file: UploadedRoomImageFile): Promise<string> {
    if (!/^[1-9][0-9]*$/.test(roomId)) {
      throw new BadRequestException('Room id khong hop le.');
    }

    this.validateDeclaredFile(file);

    let image: sharp.Sharp;
    let metadata: sharp.Metadata;

    try {
      image = sharp(file.buffer, {
        animated: false,
        failOn: 'error',
        limitInputPixels: ROOM_IMAGE_MAX_PIXELS,
      });
      metadata = await image.metadata();
    } catch {
      throw new BadRequestException('Tep tai len khong phai anh hop le.');
    }

    const detectedMimeType = metadata.format
      ? ALLOWED_FORMATS.get(metadata.format)
      : undefined;

    if (
      detectedMimeType === undefined ||
      detectedMimeType !== file.mimetype ||
      metadata.width === undefined ||
      metadata.height === undefined ||
      (metadata.pages ?? 1) !== 1 ||
      metadata.width * metadata.height > ROOM_IMAGE_MAX_PIXELS
    ) {
      throw new BadRequestException(
        'Tep tai len khong phai anh JPEG, PNG hoac WebP hop le.',
      );
    }

    let optimizedImage: Buffer;

    try {
      optimizedImage = await image
        .rotate()
        .resize({
          width: ROOM_IMAGE_MAX_EDGE,
          height: ROOM_IMAGE_MAX_EDGE,
          fit: 'inside',
          withoutEnlargement: true,
        })
        .webp({ effort: 4, quality: 82 })
        .toBuffer();
    } catch {
      throw new BadRequestException('Khong the xu ly tep anh da tai len.');
    }

    const fileName = `${randomUUID()}.webp`;
    const roomDirectory = resolve(this.uploadDirectory, roomId);

    await mkdir(roomDirectory, { recursive: true });
    await writeFile(resolve(roomDirectory, fileName), optimizedImage, {
      flag: 'wx',
    });

    return `${ROOM_IMAGE_PUBLIC_PATH}/${roomId}/${fileName}`;
  }

  async deleteManaged(imageUrl: string): Promise<void> {
    const match = MANAGED_IMAGE_PATH.exec(imageUrl);

    if (match === null) {
      return;
    }

    const [, roomId, fileName] = match;

    try {
      await unlink(resolve(this.uploadDirectory, roomId, fileName));
    } catch (error: unknown) {
      if (
        error !== null &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return;
      }

      const message =
        error instanceof Error ? error.message : 'Unknown storage error';
      this.logger.warn(`Khong the xoa tep anh ${imageUrl}: ${message}`);
    }
  }

  private validateDeclaredFile(file: UploadedRoomImageFile): void {
    if (
      !Buffer.isBuffer(file.buffer) ||
      file.buffer.length === 0 ||
      file.buffer.length > ROOM_IMAGE_MAX_FILE_SIZE ||
      file.size !== file.buffer.length ||
      ![...ALLOWED_FORMATS.values()].includes(file.mimetype)
    ) {
      throw new BadRequestException(
        'Anh phai la JPEG, PNG hoac WebP va khong vuot qua 8 MiB.',
      );
    }
  }
}
