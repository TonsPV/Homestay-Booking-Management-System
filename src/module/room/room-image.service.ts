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
    private readonly roomImageStorage: RoomImageStorageService,
  ) {}

  async create(
    roomId: string,
    body: CreateRoomImageDto | undefined,
    file?: UploadedRoomImageFile,
  ): Promise<RoomImageResponse> {
    this.validateId(roomId, 'Room id khong hop le.');
    const input = body ?? {};
    const sortOrder = this.parseSortOrder(input.sortOrder);
    const requestedCover = parseBoolean(
      input.isCover,
      false,
      'Gia tri anh bia khong hop le.',
    );

    if (file === undefined) {
      throw new BadRequestException('Vui long chon tep anh.');
    }

    const imageUrl = await this.roomImageStorage.store(roomId, file);
    let queryRunner: QueryRunner;

    try {
      queryRunner = this.dataSource.createQueryRunner();
    } catch (error) {
      await this.roomImageStorage.deleteManaged(imageUrl);
      throw error;
    }

    try {
      await queryRunner.connect();
      await queryRunner.startTransaction();
      await this.getLockedActiveRoom(queryRunner.manager, roomId);

      const imagesRepository = queryRunner.manager.getRepository(RoomImage);
      const imageCount = await imagesRepository.countBy({ roomId });
      const isCover = requestedCover || imageCount === 0;

      if (isCover) {
        await imagesRepository.update({ roomId }, { isCover: false });
      }

      const image = imagesRepository.create({
        roomId,
        imageUrl,
        sortOrder,
        isCover,
      });
      const savedImage = await imagesRepository.save(image);

      await queryRunner.commitTransaction();

      return this.toResponse(savedImage);
    } catch (error) {
      if (queryRunner.isTransactionActive) {
        await queryRunner.rollbackTransaction();
      }

      await this.roomImageStorage.deleteManaged(imageUrl);

      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async delete(imageId: string): Promise<RoomImageResponse> {
    this.validateId(imageId, 'Image id khong hop le.');

    const response = await this.dataSource.transaction(async (manager) => {
      const imagesRepository = manager.getRepository(RoomImage);
      const image = await this.getLockedRoomImage(manager, imageId);

      const response = this.toResponse(image);
      await imagesRepository.remove(image);

      if (image.isCover) {
        const nextCover = await imagesRepository.findOne({
          where: { roomId: image.roomId },
          order: { sortOrder: 'ASC', id: 'ASC' },
        });

        if (nextCover !== null) {
          nextCover.isCover = true;
          await imagesRepository.save(nextCover);
        }
      }

      return response;
    });

    await this.roomImageStorage.deleteManaged(response.imageUrl);

    return response;
  }

  setCover(imageId: string): Promise<RoomImageResponse> {
    this.validateId(imageId, 'Image id khong hop le.');

    return this.dataSource.transaction(async (manager) => {
      const imagesRepository = manager.getRepository(RoomImage);
      const image = await this.getLockedRoomImage(manager, imageId);

      await imagesRepository.update(
        { roomId: image.roomId },
        { isCover: false },
      );
      image.isCover = true;

      return this.toResponse(await imagesRepository.save(image));
    });
  }

  private async getLockedActiveRoom(
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

  private async getLockedRoomImage(
    manager: EntityManager,
    imageId: string,
  ): Promise<RoomImage> {
    const imagesRepository = manager.getRepository(RoomImage);
    const imageSnapshot = await imagesRepository.findOne({
      select: { id: true, roomId: true },
      where: { id: imageId },
    });

    if (imageSnapshot === null) {
      throw new NotFoundException('Khong tim thay anh phong.');
    }

    await this.getLockedActiveRoom(manager, imageSnapshot.roomId);

    const image = await imagesRepository.findOneBy({
      id: imageId,
      roomId: imageSnapshot.roomId,
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
