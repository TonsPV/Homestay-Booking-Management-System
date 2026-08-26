import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager, Repository } from 'typeorm';

import { getMysqlDuplicateKey } from '../../common/database';
import { ErrorCode } from '../../common/error-codes';
import { AppHttpException } from '../../common/http/app-http-exception';
import {
  createPaginationMeta,
  type PaginationMeta,
} from '../../common/pagination/pagination.types';
import {
  optionalPositiveDecimalAmount,
  optionalNullableTrimmedString,
  optionalSearch,
  optionalTrimmedString,
  parseBoolean,
  parsePagination,
  requirePositiveDecimalAmount,
  requirePositiveInt,
  requireTrimmedString,
} from '../../common/validation';
import { CreateRoomTypeDto } from './dto/create-room-type.dto';
import { SetRoomTypeAmenitiesDto } from './dto/set-room-type-amenities.dto';
import {
  AdminListRoomTypesQueryDto,
  ListRoomTypesQueryDto,
} from './dto/list-room-types-query.dto';
import { UpdateRoomTypeDto } from './dto/update-room-type.dto';
import {
  BedType,
  MAX_BED_QUANTITY,
  MAX_BED_TYPES,
  sortBedConfigurations,
  type BedConfiguration,
} from './bed-configuration';
import { RoomType } from './schema/room-type.entity';
import { RoomTypeBed } from './schema/room-type-bed.entity';
import { Amenity } from '../amenity/schema/amenity.entity';
import { Room } from '../room/schema/room.entity';

export interface RoomTypeAmenityResponse {
  id: string;
  name: string;
  description: string | null;
}

export interface RoomTypeResponse {
  id: string;
  name: string;
  description: string | null;
  bedType: string | null;
  beds: BedConfiguration[];
  maxGuests: number;
  basePrice: string;
  amenities: RoomTypeAmenityResponse[];
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminRoomTypeResponse extends RoomTypeResponse {
  deletedAt: Date | null;
}

interface RoomTypeListResult<TItem> {
  items: TItem[];
  meta: PaginationMeta;
}

@Injectable()
export class RoomTypeService {
  constructor(
    @InjectRepository(RoomType)
    private readonly roomTypesRepository: Repository<RoomType>,
  ) {}

  async listPublic(
    query: ListRoomTypesQueryDto,
  ): Promise<RoomTypeListResult<RoomTypeResponse>> {
    const result = await this.list(query, false);

    return {
      items: result.items.map((roomType) => this.toPublicResponse(roomType)),
      meta: result.meta,
    };
  }

  async getPublic(id: string): Promise<RoomTypeResponse> {
    return this.toPublicResponse(await this.getActiveRoomType(id));
  }

  async listAdmin(
    query: AdminListRoomTypesQueryDto,
  ): Promise<RoomTypeListResult<AdminRoomTypeResponse>> {
    const includeDeleted = parseBoolean(
      query.includeDeleted,
      false,
      'Include deleted khong hop le.',
    );
    const result = await this.list(query, includeDeleted);

    return {
      items: result.items.map((roomType) => this.toAdminResponse(roomType)),
      meta: result.meta,
    };
  }

  async getAdmin(id: string): Promise<AdminRoomTypeResponse> {
    return this.toAdminResponse(await this.getRoomTypeWithDeleted(id));
  }

  async create(body: CreateRoomTypeDto): Promise<AdminRoomTypeResponse> {
    this.rejectLegacyAndNormalizedBeds(body.bedType, body.beds);
    const name = requireTrimmedString(
      body.name,
      'Ten loai phong khong hop le.',
      120,
    );
    const description =
      optionalNullableTrimmedString(
        body.description,
        'Mo ta khong hop le.',
        10000,
      ) ?? null;
    const bedType =
      optionalNullableTrimmedString(
        body.bedType,
        'Loai giuong khong hop le.',
        120,
      ) ?? null;
    const beds = this.normalizeBeds(body.beds);
    const maxGuests = requirePositiveInt(
      body.maxGuests,
      'So khach toi da khong hop le.',
      100,
    );
    const basePrice = requirePositiveDecimalAmount(
      body.basePrice,
      'Gia co ban khong hop le.',
    );

    await this.ensureNameIsAvailable(name);

    try {
      const roomType = await this.roomTypesRepository.manager.transaction(
        async (manager) => {
          const roomType = manager.getRepository(RoomType).create({
            name,
            description,
            bedType,
            maxGuests,
            basePrice,
          });
          const savedRoomType = await manager
            .getRepository(RoomType)
            .save(roomType);

          if (beds !== undefined) {
            await this.replaceBeds(manager, savedRoomType.id, beds);
          }

          return this.getRoomTypeForManager(manager, savedRoomType.id, false);
        },
      );
      return this.toAdminResponse(roomType);
    } catch (error) {
      this.throwRoomTypeDuplicateConflict(error);
    }
  }

  async update(
    id: string,
    body: UpdateRoomTypeDto,
  ): Promise<AdminRoomTypeResponse> {
    this.rejectLegacyAndNormalizedBeds(body.bedType, body.beds);
    const name = optionalTrimmedString(
      body.name,
      'Ten loai phong khong hop le.',
      120,
    );
    const description = optionalNullableTrimmedString(
      body.description,
      'Mo ta khong hop le.',
      10000,
    );
    const bedType = optionalNullableTrimmedString(
      body.bedType,
      'Loai giuong khong hop le.',
      120,
    );
    const beds = this.normalizeBeds(body.beds);
    const maxGuests =
      body.maxGuests === undefined
        ? undefined
        : requirePositiveInt(
            body.maxGuests,
            'So khach toi da khong hop le.',
            100,
          );
    const basePrice = optionalPositiveDecimalAmount(
      body.basePrice,
      'Gia co ban khong hop le.',
    );

    if (
      name === undefined &&
      description === undefined &&
      bedType === undefined &&
      beds === undefined &&
      maxGuests === undefined &&
      basePrice === undefined
    ) {
      throw new BadRequestException('Khong co du lieu de cap nhat.');
    }

    if (name !== undefined) {
      await this.ensureNameIsAvailable(name, id);
    }

    try {
      const roomType = await this.roomTypesRepository.manager.transaction(
        async (manager) => {
          const roomType = await this.getLockedActiveRoomTypeForMutation(
            manager,
            id,
          );

          if (name !== undefined) {
            roomType.name = name;
          }

          if (description !== undefined) {
            roomType.description = description;
          }

          if (bedType !== undefined) {
            roomType.bedType = bedType;
          }

          if (maxGuests !== undefined) {
            roomType.maxGuests = maxGuests;
          }

          if (basePrice !== undefined) {
            roomType.basePrice = basePrice;
          }

          await manager.getRepository(RoomType).save(roomType);

          if (beds !== undefined) {
            await this.replaceBeds(manager, roomType.id, beds);
          }

          return this.getRoomTypeForManager(manager, roomType.id, false);
        },
      );
      return this.toAdminResponse(roomType);
    } catch (error) {
      this.throwRoomTypeDuplicateConflict(error);
    }
  }

  async softDelete(id: string): Promise<AdminRoomTypeResponse> {
    this.validateId(id);
    await this.roomTypesRepository.manager.transaction(async (manager) => {
      const roomType = await this.getLockedActiveRoomTypeForMutation(
        manager,
        id,
      );

      if (await this.hasActiveRooms(manager, roomType.id)) {
        throw new AppHttpException(
          HttpStatus.CONFLICT,
          ErrorCode.ROOM_TYPE_IN_USE,
          'Khong the xoa loai phong dang duoc phong su dung.',
        );
      }

      await manager.getRepository(RoomType).softRemove(roomType);
    });

    return this.getAdmin(id);
  }

  private async getLockedActiveRoomTypeForMutation(
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

    if (roomType === null || roomType.deletedAt !== null) {
      throw new NotFoundException('Khong tim thay loai phong.');
    }

    return roomType;
  }

  private async getLockedActiveAmenities(
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
        amenityIds: this.sortIds(amenityIds),
      })
      .orderBy('amenity.id', 'ASC')
      .setLock('pessimistic_write')
      .getMany();

    if (
      amenities.length !== amenityIds.length ||
      amenities.some((amenity) => amenity.deletedAt !== null)
    ) {
      throw new BadRequestException(
        'Danh sach tien nghi chua id khong ton tai hoac da bi xoa.',
      );
    }

    return amenities;
  }

  private sortIds(ids: string[]): string[] {
    return [...ids].sort(
      (left, right) => left.length - right.length || left.localeCompare(right),
    );
  }

  async restore(id: string): Promise<AdminRoomTypeResponse> {
    this.validateId(id);
    try {
      await this.roomTypesRepository.manager.transaction(async (manager) => {
        const amenityIds = await this.getRoomTypeAmenityIds(manager, id);
        const amenities = await this.getLockedAmenitiesIncludingDeleted(
          manager,
          amenityIds,
        );
        const roomType = await this.getLockedDeletedRoomTypeForRestore(
          manager,
          id,
        );

        await this.ensureNameIsAvailable(roomType.name, roomType.id, manager);

        const staleAmenityIds = amenities
          .filter((amenity) => amenity.deletedAt !== null)
          .map((amenity) => amenity.id);
        if (staleAmenityIds.length > 0) {
          await this.removeRoomTypeAmenityRelations(
            manager,
            roomType.id,
            staleAmenityIds,
          );
        }

        await manager.getRepository(RoomType).recover(roomType);
      });

      return this.getAdmin(id);
    } catch (error) {
      this.throwRoomTypeDuplicateConflict(error);
    }
  }

  async setAmenities(
    id: string,
    body: SetRoomTypeAmenitiesDto,
  ): Promise<AdminRoomTypeResponse> {
    this.validateId(id);
    const amenityIds = this.requireAmenityIds(body.amenityIds);

    await this.roomTypesRepository.manager.transaction(async (manager) => {
      const amenities = await this.getLockedActiveAmenities(
        manager,
        amenityIds,
      );
      const roomType = await this.getLockedActiveRoomTypeForMutation(
        manager,
        id,
      );

      roomType.amenities = amenities.sort((left, right) =>
        left.name.localeCompare(right.name),
      );
      await manager.getRepository(RoomType).save(roomType);
    });

    return this.getAdmin(id);
  }

  private async list(
    query: ListRoomTypesQueryDto,
    includeDeleted: boolean,
  ): Promise<RoomTypeListResult<RoomType>> {
    const { page, limit, skip } = parsePagination(
      query as Record<string, unknown>,
    );
    const search = optionalSearch(query.search);
    const roomTypesQuery = this.roomTypesRepository
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

  private async getActiveRoomType(id: string): Promise<RoomType> {
    this.validateId(id);

    const roomType = await this.roomTypesRepository
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

  private async getRoomTypeWithDeleted(id: string): Promise<RoomType> {
    this.validateId(id);

    const roomType = await this.roomTypesRepository
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

  private async getRoomTypeAmenityIds(
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

    return this.sortIds(rows.map((row) => String(row.amenityId)));
  }

  private async getLockedAmenitiesIncludingDeleted(
    manager: EntityManager,
    amenityIds: string[],
  ): Promise<Amenity[]> {
    if (amenityIds.length === 0) {
      return [];
    }

    const sortedAmenityIds = this.sortIds(amenityIds);
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

    if (amenities.length !== sortedAmenityIds.length) {
      throw new NotFoundException('Khong tim thay tien nghi cua loai phong.');
    }

    return amenities;
  }

  private async getLockedDeletedRoomTypeForRestore(
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

    if (roomType === null) {
      throw new NotFoundException('Khong tim thay loai phong.');
    }

    if (roomType.deletedAt === null) {
      throw new BadRequestException('Loai phong chua bi xoa.');
    }

    return roomType;
  }

  private async removeRoomTypeAmenityRelations(
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

  private async ensureNameIsAvailable(
    name: string,
    currentRoomTypeId?: string,
    manager: EntityManager = this.roomTypesRepository.manager,
  ): Promise<void> {
    const roomTypesRepository =
      manager === this.roomTypesRepository.manager
        ? this.roomTypesRepository
        : manager.getRepository(RoomType);
    const query = roomTypesRepository
      .createQueryBuilder('roomType')
      .withDeleted()
      .where('roomType.name = :name', { name });

    if (currentRoomTypeId !== undefined) {
      query.andWhere('roomType.id <> :currentRoomTypeId', {
        currentRoomTypeId,
      });
    }

    if ((await query.getOne()) !== null) {
      throw new ConflictException(
        'Ten loai phong da ton tai, ke ca trong du lieu da xoa.',
      );
    }
  }

  private async getRoomTypeForManager(
    manager: EntityManager,
    id: string,
    includeDeleted: boolean,
  ): Promise<RoomType> {
    this.validateId(id);

    const query = manager
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
      query.withDeleted();
    } else {
      query.andWhere('roomType.deletedAt IS NULL');
    }

    const roomType = await query.getOne();

    if (roomType === null) {
      throw new NotFoundException('Khong tim thay loai phong.');
    }

    return roomType;
  }

  private async replaceBeds(
    manager: EntityManager,
    roomTypeId: string,
    beds: BedConfiguration[],
  ): Promise<void> {
    const bedsRepository = manager.getRepository(RoomTypeBed);

    await bedsRepository.delete({ roomTypeId });

    if (beds.length > 0) {
      await bedsRepository.save(
        beds.map((bed) =>
          bedsRepository.create({
            roomTypeId,
            bedType: bed.type,
            quantity: bed.quantity,
          }),
        ),
      );
    }
  }

  private rejectLegacyAndNormalizedBeds(
    legacyValue: unknown,
    normalizedValue: unknown,
  ): void {
    if (legacyValue !== undefined && normalizedValue !== undefined) {
      throw new BadRequestException(
        'Khong the gui dong thoi bedType va beds. Hay dung beds.',
      );
    }
  }

  private normalizeBeds(value: unknown): BedConfiguration[] | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (!Array.isArray(value) || value.length > MAX_BED_TYPES) {
      throw new BadRequestException(
        `beds phai la mang toi da ${MAX_BED_TYPES} phan tu.`,
      );
    }

    const seenTypes = new Set<BedType>();
    const beds: BedConfiguration[] = [];

    for (const item of value) {
      if (item === null || typeof item !== 'object' || Array.isArray(item)) {
        throw new BadRequestException('Cau hinh giuong khong hop le.');
      }

      const record = item as Record<string, unknown>;
      const unknownKeys = Object.keys(record).filter(
        (key) => key !== 'type' && key !== 'quantity',
      );

      if (unknownKeys.length > 0) {
        throw new BadRequestException('Cau hinh giuong khong hop le.');
      }

      const type = record.type;
      const quantity = record.quantity;

      if (
        typeof type !== 'string' ||
        !Object.values(BedType).includes(type as BedType)
      ) {
        throw new BadRequestException('Loai giuong khong hop le.');
      }

      if (
        typeof quantity !== 'number' ||
        !Number.isSafeInteger(quantity) ||
        quantity < 1 ||
        quantity > MAX_BED_QUANTITY
      ) {
        throw new BadRequestException('So luong giuong khong hop le.');
      }

      const bedType = type as BedType;

      if (seenTypes.has(bedType)) {
        throw new BadRequestException(
          'Moi loai giuong chi duoc xuat hien mot lan.',
        );
      }

      seenTypes.add(bedType);
      beds.push({ type: bedType, quantity });
    }

    return sortBedConfigurations(beds);
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

  private throwRoomTypeDuplicateConflict(error: unknown): never {
    if (getMysqlDuplicateKey(error) === undefined) {
      throw error;
    }

    throw new ConflictException(
      'Ten loai phong da ton tai, ke ca trong du lieu da xoa.',
    );
  }

  private validateId(id: string): void {
    if (!/^[1-9][0-9]*$/.test(id)) {
      throw new BadRequestException('Id khong hop le.');
    }
  }

  private requireAmenityIds(value: unknown): string[] {
    if (!Array.isArray(value) || value.length > 50) {
      throw new BadRequestException(
        'Danh sach amenityIds phai la mang toi da 50 phan tu.',
      );
    }

    const ids = value.map((item) => String(item));

    if (ids.some((id) => !/^[1-9][0-9]*$/.test(id))) {
      throw new BadRequestException('Amenity id khong hop le.');
    }

    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('Amenity id khong duoc trung lap.');
    }

    return ids;
  }

  private toPublicResponse(roomType: RoomType): RoomTypeResponse {
    return {
      id: roomType.id,
      name: roomType.name,
      description: roomType.description,
      bedType: roomType.bedType,
      beds: this.toBedConfigurations(roomType),
      maxGuests: roomType.maxGuests,
      basePrice: roomType.basePrice,
      amenities: (roomType.amenities ?? []).map((amenity) => ({
        id: amenity.id,
        name: amenity.name,
        description: amenity.description,
      })),
      createdAt: roomType.createdAt,
      updatedAt: roomType.updatedAt,
    };
  }

  private toBedConfigurations(roomType: RoomType): BedConfiguration[] {
    return sortBedConfigurations(
      (roomType.beds ?? []).map((bed) => ({
        type: bed.bedType,
        quantity: bed.quantity,
      })),
    );
  }

  private toAdminResponse(roomType: RoomType): AdminRoomTypeResponse {
    return {
      ...this.toPublicResponse(roomType),
      deletedAt: roomType.deletedAt,
    };
  }
}
