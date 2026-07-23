import { DataSource } from 'typeorm';

import { RoomImageService } from './room-image.service';
import { RoomImage } from './schema/room-image.entity';
import { Room } from './schema/room.entity';

describe('RoomImageService', () => {
  it('rolls back and releases the query runner when saving fails', async () => {
    const saveError = new Error('save failed');
    const roomQuery = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue({ id: '1' }),
    };
    const roomRepository = {
      createQueryBuilder: jest.fn().mockReturnValue(roomQuery),
    };
    const imagesRepository = {
      countBy: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({ affected: 0 }),
      create: jest.fn().mockImplementation((value: unknown) => value),
      save: jest.fn().mockRejectedValue(saveError),
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        if (entity === Room) {
          return roomRepository;
        }

        if (entity === RoomImage) {
          return imagesRepository;
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
    const service = new RoomImageService(dataSource);

    await expect(
      service.create('1', {
        imageUrl: 'https://example.com/room.jpg',
        isCover: true,
      }),
    ).rejects.toBe(saveError);

    expect(roomQuery.setLock).toHaveBeenCalledWith('pessimistic_write');
    expect(queryRunner.rollbackTransaction).toHaveBeenCalledTimes(1);
    expect(queryRunner.commitTransaction).not.toHaveBeenCalled();
    expect(queryRunner.release).toHaveBeenCalledTimes(1);
  });
});
