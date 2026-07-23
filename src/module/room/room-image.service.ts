import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { parseBoolean, requireTrimmedString } from '../../common/validation';
import { CreateRoomImageDto } from './dto/create-room-image.dto';
import { RoomImage } from './schema/room-image.entity';
import { Room } from './schema/room.entity';
import type { RoomImageResponse } from './room.service';

@Injectable()
export class RoomImageService {
  constructor(private readonly dataSource: DataSource) {}

  async create(
    roomId: string,
    body: CreateRoomImageDto,
  ): Promise<RoomImageResponse> {
    this.validateId(roomId, 'Room id khong hop le.');
    const imageUrl = this.requireImageUrl(body.imageUrl);
    const sortOrder = this.parseSortOrder(body.sortOrder);
    const requestedCover = parseBoolean(
      body.isCover,
      false,
      'Gia tri anh bia khong hop le.',
    );
    const queryRunner = this.dataSource.createQueryRunner();

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

      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  delete(imageId: string): Promise<RoomImageResponse> {
    this.validateId(imageId, 'Image id khong hop le.');

    return this.dataSource.transaction(async (manager) => {
      const imagesRepository = manager.getRepository(RoomImage);
      const image = await imagesRepository.findOneBy({ id: imageId });

      if (image === null) {
        throw new NotFoundException('Khong tim thay anh phong.');
      }

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
  }

  setCover(imageId: string): Promise<RoomImageResponse> {
    this.validateId(imageId, 'Image id khong hop le.');

    return this.dataSource.transaction(async (manager) => {
      const imagesRepository = manager.getRepository(RoomImage);
      const image = await imagesRepository.findOneBy({ id: imageId });

      if (image === null) {
        throw new NotFoundException('Khong tim thay anh phong.');
      }

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

  private requireImageUrl(value: unknown): string {
    const imageUrl = requireTrimmedString(value, 'URL anh khong hop le.', 500);

    try {
      const url = new URL(imageUrl);

      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new Error('Unsupported protocol');
      }
    } catch {
      throw new BadRequestException('URL anh khong hop le.');
    }

    return imageUrl;
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
