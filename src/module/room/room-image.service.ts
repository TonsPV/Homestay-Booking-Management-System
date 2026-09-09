import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, type EntityManager, type QueryRunner } from 'typeorm';

import { parseBoolean } from '../../common/validation';
import { CreateRoomImageDto } from './dto/create-room-image.dto';
import {
  RoomImageStorageService,
  type UploadedRoomImageFile,
} from './room-image-storage.service';
import { RoomImage } from './schema/room-image.entity';
import { Room } from './schema/room.entity';
import type { RoomImageResponse } from './room.service';

@Injectable()
export class RoomImageService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly imageStorage: RoomImageStorageService,
  ) {}

  async create(
    roomId: string,
    body: CreateRoomImageDto | undefined,
    file?: UploadedRoomImageFile,
  ): Promise<RoomImageResponse> {
    this.validateId(roomId, 'Room id khong hop le.');
    const imageInput = body ?? {};
    const sortOrder = this.parseSortOrder(imageInput.sortOrder);
    const requestedCover = parseBoolean(
      imageInput.isCover,
      false,
      'Gia tri anh bia khong hop le.',
    );

    if (file === undefined) {
      throw new BadRequestException('Vui long chon tep anh.');
    }

    const imageUrl = await this.imageStorage.store(roomId, file);
    let queryRunner: QueryRunner;

    try {
      queryRunner = this.dataSource.createQueryRunner();
    } catch (error) {
      await this.imageStorage.deleteManaged(imageUrl);
      throw error;
    }

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();
      await this.lockRoom(queryRunner.manager, roomId);

      const imageRepo = queryRunner.manager.getRepository(RoomImage);
      const imageCount = await imageRepo.countBy({ roomId });
      const isCover = requestedCover || imageCount === 0;

      if (isCover) {
        await imageRepo.update({ roomId }, { isCover: false });
      }

      const image = imageRepo.create({
        roomId,
        imageUrl,
        sortOrder,
        isCover,
      });
      const savedImage = await imageRepo.save(image);

      await queryRunner.commitTransaction();

      return this.toResponse(savedImage);
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }

      await this.imageStorage.deleteManaged(imageUrl);

      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async delete(imageId: string): Promise<RoomImageResponse> {
    this.validateId(imageId, 'Image id khong hop le.');

    const deletedImage = await this.dataSource.transaction(async (manager) => {
      const imageRepo = manager.getRepository(RoomImage);
      const image = await this.lockImage(manager, imageId);

      const imageResponse = this.toResponse(image);
      await imageRepo.remove(image);

      if (image.isCover) {
        const nextCover = await imageRepo.findOne({
          where: { roomId: image.roomId },
          order: { sortOrder: 'ASC', id: 'ASC' },
          // The first image lookup is a consistent read used only to discover
          // the Room id.  Use a current/locking read after the Room lock so
          // this selection cannot be based on a repeatable-read snapshot
          // taken before another image mutation committed.
          lock: { mode: 'pessimistic_write' },
        });

        if (nextCover !== null) {
          // TypeORM save() performs a consistent-read diff before issuing its
          // UPDATE. That diff can still see the snapshot created before the
          // Room lock, so it may conclude that a stale `isCover=true` value is
          // already persisted and skip the promotion. Use a direct update,
          // just like setCover(), to force the current-row write.
          await imageRepo.update(
            { id: nextCover.id, roomId: image.roomId },
            { isCover: true },
          );
        }
      }

      return imageResponse;
    });

    await this.imageStorage.deleteManaged(deletedImage.imageUrl);

    return deletedImage;
  }

  setCover(imageId: string): Promise<RoomImageResponse> {
    this.validateId(imageId, 'Image id khong hop le.');

    return this.dataSource.transaction(async (manager) => {
      const imageRepo = manager.getRepository(RoomImage);
      const image = await this.lockImage(manager, imageId);

      await imageRepo.update({ roomId: image.roomId }, { isCover: false });

      // Do not use save(image) here. The entity can come from a repeatable-read
      // snapshot where it was already the cover, so TypeORM may detect no
      // change after the bulk reset above and leave the room with no cover.
      await imageRepo.update(
        { id: image.id, roomId: image.roomId },
        { isCover: true },
      );
      image.isCover = true;

      return this.toResponse(image);
    });
  }

  private async lockRoom(
    manager: EntityManager,
    roomId: string,
  ): Promise<Room> {
    const room = await manager
      .getRepository(Room)
      .createQueryBuilder('room')
      .setLock('pessimistic_write')
      .where('room.id = :roomId', { roomId })
      .andWhere('room.deletedAt IS NULL')
      .getOne();

    if (room === null) {
      throw new NotFoundException('Khong tim thay phong.');
    }

    return room;
  }

  private async lockImage(
    manager: EntityManager,
    imageId: string,
  ): Promise<RoomImage> {
    const imageRepo = manager.getRepository(RoomImage);
    const imageSnapshot = await imageRepo.findOne({
      select: { id: true, roomId: true },
      where: { id: imageId },
    });

    if (imageSnapshot === null) {
      throw new NotFoundException('Khong tim thay anh phong.');
    }

    await this.lockRoom(manager, imageSnapshot.roomId);

    // The Room lock serializes all image mutations for this Room.  This must
    // be a locking (current) read as well: a normal repository read here can
    // reuse the snapshot created by imageSnapshot under MySQL REPEATABLE READ
    // and return a stale isCover value.
    const image = await imageRepo.findOne({
      where: { id: imageId, roomId: imageSnapshot.roomId },
      lock: { mode: 'pessimistic_write' },
    });

    if (image === null) {
      throw new NotFoundException('Khong tim thay anh phong.');
    }

    return image;
  }

  private parseSortOrder(value: unknown): number {
    if (value === undefined || value === null || value === '') {
      return 0;
    }

    const sortOrder =
      typeof value === 'number'
        ? value
        : typeof value === 'string'
          ? Number(value)
          : Number.NaN;

    if (
      !Number.isInteger(sortOrder) ||
      sortOrder < 0 ||
      sortOrder > 2147483647
    ) {
      throw new BadRequestException('Thu tu anh khong hop le.');
    }

    return sortOrder;
  }

  private validateId(id: string, message: string): void {
    if (!/^[1-9][0-9]*$/.test(id)) {
      throw new BadRequestException(message);
    }
  }

  private toResponse(image: RoomImage): RoomImageResponse {
    return {
      id: image.id,
      imageUrl: image.imageUrl,
      sortOrder: image.sortOrder,
      isCover: image.isCover,
    };
  }
}
