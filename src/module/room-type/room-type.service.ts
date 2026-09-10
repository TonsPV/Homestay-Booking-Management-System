import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager, Repository } from 'typeorm';

import { getMysqlDuplicateKey } from '../../common/database';
import { createPaginationMeta } from '../../common/pagination/pagination.types';
import {
  optionalSearch,
  parseBoolean,
  parsePagination,
  requireId,
} from '../../common/validation';
import { CreateRoomTypeDto } from './dto/create-room-type.dto';
import { SetRoomTypeAmenitiesDto } from './dto/set-room-type-amenities.dto';
import {
  AdminListRoomTypesQueryDto,
  ListRoomTypesQueryDto,
} from './dto/list-room-types-query.dto';
import { UpdateRoomTypeDto } from './dto/update-room-type.dto';
import type { BedConfig } from './bed-configuration';
import {
  assertActiveAmenities,
  assertAllAmenitiesFound,
  assertRoomTypeNotInUse,
  requireActiveRoomType,
  requireAmenityIds,
  requireDeletedRoomType,
} from './domain/room-type.policy';
import {
  applyRoomTypeUpdate,
  buildRoomTypeBedPersistenceInputs,
  getDeletedAmenityIds,
  normalizeCreateRoomType,
  normalizeUpdateRoomType,
  sortAmenitiesByName,
  sortNumericIds,
  toAdminRoomTypeResponse,
  toPublicRoomTypeResponse,
  toRoomTypeEntityInput,
} from './mappers/room-type.mapper';
import {
  type AdminRoomTypeResponse,
  type RoomTypeListResult,
  type RoomTypeResponse,
} from './room-type.types';
import { RoomType } from './schema/room-type.entity';
import { RoomTypeBed } from './schema/room-type-bed.entity';
import { Amenity } from '../amenity/schema/amenity.entity';
import { Room } from '../room/schema/room.entity';

@Injectable()
export class RoomTypeService {
  constructor(
    @InjectRepository(RoomType)
    private readonly roomTypeRepo: Repository<RoomType>,
  ) {}

  async listPublic(
    query: ListRoomTypesQueryDto,
  ): Promise<RoomTypeListResult<RoomTypeResponse>> {
    const listResult = await this.findList(query, false);

    return {
      items: listResult.items.map((roomType) =>
        toPublicRoomTypeResponse(roomType),
      ),
      meta: listResult.meta,
    };
  }

  async getPublic(id: string): Promise<RoomTypeResponse> {
    return toPublicRoomTypeResponse(await this.findActive(id));
  }

  async listAdmin(
    query: AdminListRoomTypesQueryDto,
  ): Promise<RoomTypeListResult<AdminRoomTypeResponse>> {
    const includeDeleted = parseBoolean(
      query.includeDeleted,
      false,
      'Include deleted khong hop le.',
    );
    const listResult = await this.findList(query, includeDeleted);

    return {
      items: listResult.items.map(toAdminRoomTypeResponse),
      meta: listResult.meta,
    };
  }

  async getAdmin(id: string): Promise<AdminRoomTypeResponse> {
    return toAdminRoomTypeResponse(await this.findWithDeleted(id));
  }

  async create(body: CreateRoomTypeDto): Promise<AdminRoomTypeResponse> {
    const input = normalizeCreateRoomType(body);

    await this.assertNameAvailable(input.name);

    try {
      const roomType = await this.roomTypeRepo.manager.transaction(
        async (manager) => {
          const roomType = manager
            .getRepository(RoomType)
            .create(toRoomTypeEntityInput(input));
          const savedRoomType = await manager
            .getRepository(RoomType)
            .save(roomType);

          if (input.beds !== undefined) {
            await this.replaceBeds(manager, savedRoomType.id, input.beds);
          }

          return this.findInTransaction(manager, savedRoomType.id, false);
        },
      );
      return toAdminRoomTypeResponse(roomType);
    } catch (error) {
      this.throwDuplicateConflict(error);
    }
  }

  async update(
    id: string,
    body: UpdateRoomTypeDto,
  ): Promise<AdminRoomTypeResponse> {
    requireId(id, '');
    const input = normalizeUpdateRoomType(body);

    if (input.name !== undefined) {
      await this.assertNameAvailable(input.name, id);
    }

    try {
      const roomType = await this.roomTypeRepo.manager.transaction(
        async (manager) => {
          const roomType = await this.lockActiveRoomType(manager, id);
          await manager
            .getRepository(RoomType)
            .save(applyRoomTypeUpdate(roomType, input));

          if (input.beds !== undefined) {
            await this.replaceBeds(manager, roomType.id, input.beds);
          }

          return this.findInTransaction(manager, roomType.id, false);
        },
      );
      return toAdminRoomTypeResponse(roomType);
    } catch (error) {
      this.throwDuplicateConflict(error);
    }
  }

  async softDelete(id: string): Promise<AdminRoomTypeResponse> {
    requireId(id, '');
    await this.roomTypeRepo.manager.transaction(async (manager) => {
      const roomType = await this.lockActiveRoomType(manager, id);

      assertRoomTypeNotInUse(await this.hasActiveRooms(manager, roomType.id));

      await manager.getRepository(RoomType).softRemove(roomType);
    });

    return this.getAdmin(id);
  }

  private async lockActiveRoomType(
    manager: EntityManager,
    id: string,
  ): Promise<RoomType> {
    const roomType = await manager
      .getRepository(RoomType)
      .createQueryBuilder('roomType')
      .withDeleted()
      .where('roomType.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();

    return requireActiveRoomType(roomType);
  }

  private async lockActiveAmenities(
    manager: EntityManager,
    amenityIds: string[],
  ): Promise<Amenity[]> {
    if (amenityIds.length === 0) {
      return [];
    }

    const amenities = await manager
      .getRepository(Amenity)
      .createQueryBuilder('amenity')
      .withDeleted()
      .where('amenity.id IN (:...amenityIds)', {
        amenityIds: sortNumericIds(amenityIds),
      })
      .orderBy('amenity.id', 'ASC')
      .setLock('pessimistic_write')
      .getMany();

    assertActiveAmenities(amenities, amenityIds.length);

    return amenities;
  }

  async restore(id: string): Promise<AdminRoomTypeResponse> {
    requireId(id, '');
    try {
      await this.roomTypeRepo.manager.transaction(async (manager) => {
        const amenityIds = await this.getAmenityIds(manager, id);
        const amenities = await this.lockAmenitiesWithDeleted(
          manager,
          amenityIds,
        );
        const roomType = await this.lockDeleted(manager, id);

        await this.assertNameAvailable(roomType.name, roomType.id, manager);

        const staleAmenityIds = getDeletedAmenityIds(amenities);
        if (staleAmenityIds.length > 0) {
          await this.removeAmenityLinks(manager, roomType.id, staleAmenityIds);
        }

        await manager.getRepository(RoomType).recover(roomType);
      });

      return this.getAdmin(id);
    } catch (error) {
      this.throwDuplicateConflict(error);
    }
  }

  async setAmenities(
    id: string,
    body: SetRoomTypeAmenitiesDto,
  ): Promise<AdminRoomTypeResponse> {
    requireId(id, '');
    const amenityIds = requireAmenityIds(body.amenityIds);

    await this.roomTypeRepo.manager.transaction(async (manager) => {
      const amenities = await this.lockActiveAmenities(manager, amenityIds);
      const roomType = await this.lockActiveRoomType(manager, id);

      roomType.amenities = sortAmenitiesByName(amenities);
      await manager.getRepository(RoomType).save(roomType);
    });

    return this.getAdmin(id);
  }

  private async findList(
    query: ListRoomTypesQueryDto,
    includeDeleted: boolean,
  ): Promise<RoomTypeListResult<RoomType>> {
    const { page, limit, skip } = parsePagination(
      query as Record<string, unknown>,
    );
    const search = optionalSearch(query.search);
    const roomTypesQuery = this.roomTypeRepo
      .createQueryBuilder('roomType')
      .leftJoinAndSelect(
        'roomType.amenities',
        'amenity',
        'amenity.deletedAt IS NULL',
      )
      .leftJoinAndSelect('roomType.beds', 'bed')
      .orderBy('roomType.createdAt', 'DESC')
      .addOrderBy('roomType.id', 'DESC')
      .addOrderBy('amenity.name', 'ASC')
      .addOrderBy('bed.bedType', 'ASC')
      .skip(skip)
      .take(limit);

    if (includeDeleted) {
      roomTypesQuery.withDeleted();
    }

    if (search !== undefined) {
      roomTypesQuery.andWhere(
        '(LOWER(roomType.name) LIKE :search OR LOWER(roomType.description) LIKE :search)',
        { search: `%${search.toLowerCase()}%` },
      );
    }

    const [items, total] = await roomTypesQuery.getManyAndCount();

    return {
      items,
      meta: createPaginationMeta(page, limit, total),
    };
  }

  private async findActive(id: string): Promise<RoomType> {
    requireId(id, '');

    const roomType = await this.roomTypeRepo
      .createQueryBuilder('roomType')
      .leftJoinAndSelect(
        'roomType.amenities',
        'amenity',
        'amenity.deletedAt IS NULL',
      )
      .leftJoinAndSelect('roomType.beds', 'bed')
      .where('roomType.id = :id', { id })
      .orderBy('amenity.name', 'ASC')
      .addOrderBy('bed.bedType', 'ASC')
      .getOne();

    if (roomType === null) {
      throw new NotFoundException('Khong tim thay loai phong.');
    }

    return roomType;
  }

  private async findWithDeleted(id: string): Promise<RoomType> {
    requireId(id, '');

    const roomType = await this.roomTypeRepo
      .createQueryBuilder('roomType')
      .withDeleted()
      .leftJoinAndSelect(
        'roomType.amenities',
        'amenity',
        'amenity.deletedAt IS NULL',
      )
      .leftJoinAndSelect('roomType.beds', 'bed')
      .where('roomType.id = :id', { id })
      .orderBy('amenity.name', 'ASC')
      .addOrderBy('bed.bedType', 'ASC')
      .getOne();

    if (roomType === null) {
      throw new NotFoundException('Khong tim thay loai phong.');
    }

    return roomType;
  }

  private async getAmenityIds(
    manager: EntityManager,
    roomTypeId: string,
  ): Promise<string[]> {
    const rows = await manager
      .createQueryBuilder()
      .select('roomTypeAmenity.amenity_id', 'amenityId')
      .from('room_type_amenities', 'roomTypeAmenity')
      .where('roomTypeAmenity.room_type_id = :roomTypeId', { roomTypeId })
      .orderBy('roomTypeAmenity.amenity_id', 'ASC')
      .getRawMany<{ amenityId: string | number }>();

    return sortNumericIds(rows.map((row) => String(row.amenityId)));
  }

  private async lockAmenitiesWithDeleted(
    manager: EntityManager,
    amenityIds: string[],
  ): Promise<Amenity[]> {
    if (amenityIds.length === 0) {
      return [];
    }

    const sortedAmenityIds = sortNumericIds(amenityIds);
    const amenities = await manager
      .getRepository(Amenity)
      .createQueryBuilder('amenity')
      .withDeleted()
      .where('amenity.id IN (:...amenityIds)', {
        amenityIds: sortedAmenityIds,
      })
      .orderBy('amenity.id', 'ASC')
      .setLock('pessimistic_write')
      .getMany();

    assertAllAmenitiesFound(amenities, sortedAmenityIds.length);

    return amenities;
  }

  private async lockDeleted(
    manager: EntityManager,
    id: string,
  ): Promise<RoomType> {
    const roomType = await manager
      .getRepository(RoomType)
      .createQueryBuilder('roomType')
      .withDeleted()
      .where('roomType.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();

    return requireDeletedRoomType(roomType);
  }

  private async removeAmenityLinks(
    manager: EntityManager,
    roomTypeId: string,
    amenityIds: string[],
  ): Promise<void> {
    await manager
      .createQueryBuilder()
      .delete()
      .from('room_type_amenities')
      .where('room_type_id = :roomTypeId', { roomTypeId })
      .andWhere('amenity_id IN (:...amenityIds)', { amenityIds })
      .execute();
  }

  private async assertNameAvailable(
    name: string,
    currentRoomTypeId?: string,
    manager: EntityManager = this.roomTypeRepo.manager,
  ): Promise<void> {
    const repository =
      manager === this.roomTypeRepo.manager
        ? this.roomTypeRepo
        : manager.getRepository(RoomType);
    const nameQuery = repository
      .createQueryBuilder('roomType')
      .withDeleted()
      .where('roomType.name = :name', { name });

    if (currentRoomTypeId !== undefined) {
      nameQuery.andWhere('roomType.id <> :currentRoomTypeId', {
        currentRoomTypeId,
      });
    }

    if ((await nameQuery.getOne()) !== null) {
      throw new ConflictException(
        'Ten loai phong da ton tai, ke ca trong du lieu da xoa.',
      );
    }
  }

  private async findInTransaction(
    manager: EntityManager,
    id: string,
    includeDeleted: boolean,
  ): Promise<RoomType> {
    requireId(id, '');

    const roomTypeQuery = manager
      .getRepository(RoomType)
      .createQueryBuilder('roomType')
      .leftJoinAndSelect(
        'roomType.amenities',
        'amenity',
        'amenity.deletedAt IS NULL',
      )
      .leftJoinAndSelect('roomType.beds', 'bed')
      .where('roomType.id = :id', { id })
      .orderBy('amenity.name', 'ASC')
      .addOrderBy('bed.bedType', 'ASC');

    if (includeDeleted) {
      roomTypeQuery.withDeleted();
    } else {
      roomTypeQuery.andWhere('roomType.deletedAt IS NULL');
    }

    const roomType = await roomTypeQuery.getOne();

    if (roomType === null) {
      throw new NotFoundException('Khong tim thay loai phong.');
    }

    return roomType;
  }

  private async replaceBeds(
    manager: EntityManager,
    roomTypeId: string,
    beds: BedConfig[],
  ): Promise<void> {
    const bedRepo = manager.getRepository(RoomTypeBed);

    await bedRepo.delete({ roomTypeId });

    if (beds.length > 0) {
      await bedRepo.save(
        buildRoomTypeBedPersistenceInputs(roomTypeId, beds).map((bed) =>
          bedRepo.create(bed),
        ),
      );
    }
  }

  private async hasActiveRooms(
    manager: EntityManager,
    roomTypeId: string,
  ): Promise<boolean> {
    const room = await manager
      .getRepository(Room)
      .createQueryBuilder('room')
      .select('room.id')
      .where('room.roomTypeId = :roomTypeId', { roomTypeId })
      .andWhere('room.deletedAt IS NULL')
      .orderBy('room.id', 'ASC')
      .setLock('pessimistic_write')
      .getOne();

    return room !== null;
  }

  private throwDuplicateConflict(error: unknown): never {
    if (getMysqlDuplicateKey(error) === undefined) {
      throw error;
    }

    throw new ConflictException(
      'Ten loai phong da ton tai, ke ca trong du lieu da xoa.',
    );
  }
}
