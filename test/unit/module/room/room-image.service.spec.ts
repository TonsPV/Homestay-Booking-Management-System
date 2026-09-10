import { BadRequestException } from '@nestjs/common';
import { DataSource } from 'typeorm';

import { RoomImageService } from '../../../../src/module/room/room-image.service';
import {
  RoomImageStorageService,
  type UploadedRoomImageFile,
} from '../../../../src/module/room/room-image-storage.service';
import { RoomImage } from '../../../../src/module/room/schema/room-image.entity';
import { Room } from '../../../../src/module/room/schema/room.entity';

describe('RoomImageService', () => {
  it('requires an uploaded file', async () => {
    const createQueryRunner = jest.fn();
    const dataSource = {
      createQueryRunner,
    } as unknown as DataSource;
    const roomImageStorage = createRoomImageStorage();
    const service = new RoomImageService(
      dataSource,
      roomImageStorage as unknown as RoomImageStorageService,
    );

    await expect(service.create('1', {})).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(roomImageStorage.store).not.toHaveBeenCalled();
    expect(createQueryRunner).not.toHaveBeenCalled();
  });

  it('rolls back and releases the query runner when saving fails', async () => {
    const saveError = new Error('save failed');
    const storedImageUrl =
      '/media/room-images/1/11111111-1111-4111-8111-111111111111.webp';
    const roomQuery = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ id: '1' }),
    };
    const roomRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(roomQuery),
    };
    const imageRepo = {
      countBy: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({ affected: 0 }),
      create: jest.fn().mockImplementation((value: unknown) => value),
      save: jest.fn().mockRejectedValue(saveError),
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === Room) {
          return roomRepo;
        }

        if (entity === RoomImage) {
          return imageRepo;
        }

        throw new Error('Unexpected repository.');
      }),
    };
    const queryRunner = {
      manager,
      isTransactionActive: true,
      connect: jest.fn().mockResolvedValue(undefined),
      startTransaction: jest.fn().mockResolvedValue(undefined),
      commitTransaction: jest.fn().mockResolvedValue(undefined),
      rollbackTransaction: jest.fn().mockImplementation(() => {
        queryRunner.isTransactionActive = false;
        return Promise.resolve();
      }),
      release: jest.fn().mockResolvedValue(undefined),
    };
    const dataSource = {
      createQueryRunner: jest.fn().mockReturnValue(queryRunner),
    } as unknown as DataSource;
    const roomImageStorage = createRoomImageStorage(storedImageUrl);
    const service = new RoomImageService(
      dataSource,
      roomImageStorage as unknown as RoomImageStorageService,
    );

    await expect(
      service.create(
        '1',
        { isCover: true },
        createUpload(Buffer.from('image'), 'image/png'),
      ),
    ).rejects.toBe(saveError);

    expect(roomQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
    expect(roomImageStorage.deleteManaged).toHaveBeenCalledWith(storedImageUrl);
  });

  it('locks the Room before changing the cover image', async () => {
    const image = {
      id: '2',
      roomId: '1',
      imageUrl: 'https://example.com/room-2.jpg',
      sortOrder: 1,
      isCover: true,
    };
    const roomQuery = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ id: '1' }),
    };
    const roomRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(roomQuery),
    };
    const imageRepo = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce({ id: '2', roomId: '1' })
        .mockResolvedValueOnce(image),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === Room) {
          return roomRepo;
        }

        if (entity === RoomImage) {
          return imageRepo;
        }

        throw new Error('Unexpected repository.');
      }),
    };
    const dataSource = {
      transaction: jest.fn(
        (callback: (value: typeof manager) => Promise<unknown>) =>
          callback(manager),
      ),
    } as unknown as DataSource;
    const roomImageStorage = createRoomImageStorage();
    const service = new RoomImageService(
      dataSource,
      roomImageStorage as unknown as RoomImageStorageService,
    );

    await expect(service.setCover('2')).resolves.toMatchObject({
      id: '2',
      isCover: true,
    });

    expect(roomQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(imageRepo.update).toHaveBeenCalledWith(
      { roomId: '1' },
      { isCover: false },
    );
    expect(imageRepo.update).toHaveBeenCalledWith(
      { id: '2', roomId: '1' },
      { isCover: true },
    );
  });

  it('locks the Room before deleting an image', async () => {
    const image = {
      id: '2',
      roomId: '1',
      imageUrl: 'https://example.com/room-2.jpg',
      sortOrder: 1,
      isCover: false,
    };
    const roomQuery = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ id: '1' }),
    };
    const roomRepo = {
      createQueryBuilder: jest.fn().mockReturnValue(roomQuery),
    };
    const imageRepo = {
      findOne: jest
        .fn()
        .mockResolvedValueOnce({ id: '2', roomId: '1' })
        .mockResolvedValueOnce(image),
      remove: jest.fn().mockResolvedValue(image),
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === Room) {
          return roomRepo;
        }

        if (entity === RoomImage) {
          return imageRepo;
        }

        throw new Error('Unexpected repository.');
      }),
    };
    const dataSource = {
      transaction: jest.fn(
        (callback: (value: typeof manager) => Promise<unknown>) =>
          callback(manager),
      ),
    } as unknown as DataSource;
    const roomImageStorage = createRoomImageStorage();
    const service = new RoomImageService(
      dataSource,
      roomImageStorage as unknown as RoomImageStorageService,
    );

    await expect(service.delete('2')).resolves.toMatchObject({ id: '2' });

    expect(roomQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(imageRepo.remove).toHaveBeenCalledWith(image);
    expect(roomImageStorage.deleteManaged).toHaveBeenCalledWith(image.imageUrl);
  });
});

interface RoomImageStorageMock {
  deleteManaged: jest.Mock;
  store: jest.Mock;
}

function createRoomImageStorage(
  storedImageUrl = '/media/room-images/1/11111111-1111-4111-8111-111111111111.webp',
): RoomImageStorageMock {
  return {
    deleteManaged: jest.fn().mockResolvedValue(undefined),
    store: jest.fn().mockResolvedValue(storedImageUrl),
  };
}

function createUpload(buffer: Buffer, mimetype: string): UploadedRoomImageFile {
  return {
    buffer,
    mimetype,
    originalname: 'room.png',
    size: buffer.length,
  };
}
