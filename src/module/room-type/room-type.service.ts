import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import { getMysqlDuplicateKey } from '../../common/database';
import type { PaginationMeta } from '../../common/http';
import {
  optionalDecimalAmount,
  optionalNullableTrimmedString,
  optionalSearch,
  optionalTrimmedString,
  parseBoolean,
  parsePagination,
  requireDecimalAmount,
  requirePositiveInt,
  requireTrimmedString,
} from '../../common/validation';
import { CreateRoomTypeDto } from './dto/create-room-type.dto';
import {
  AdminListRoomTypesQueryDto,
  ListRoomTypesQueryDto,
} from './dto/list-room-types-query.dto';
import { UpdateRoomTypeDto } from './dto/update-room-type.dto';
import { RoomType } from './schema/room-type.entity';

export interface RoomTypeResponse {
  id: string;
  name: string;
  description: string | null;
  maxGuests: number;
  basePrice: string;
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
    const maxGuests = requirePositiveInt(
      body.maxGuests,
      'So khach toi da khong hop le.',
    );
    const basePrice = requireDecimalAmount(
      body.basePrice,
      'Gia co ban khong hop le.',
    );

    await this.ensureNameIsAvailable(name);

    const roomType = this.roomTypesRepository.create({
      name,
      description,
      maxGuests,
      basePrice,
    });

    try {
      return this.toAdminResponse(
        await this.roomTypesRepository.save(roomType),
      );
    } catch (error) {
      this.throwRoomTypeDuplicateConflict(error);
    }
  }

  async update(
    id: string,
    body: UpdateRoomTypeDto,
  ): Promise<AdminRoomTypeResponse> {
    const roomType = await this.getActiveRoomType(id);
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
    const maxGuests =
      body.maxGuests === undefined
        ? undefined
        : requirePositiveInt(body.maxGuests, 'So khach toi da khong hop le.');
    const basePrice = optionalDecimalAmount(
      body.basePrice,
      'Gia co ban khong hop le.',
    );

    if (
      name === undefined &&
      description === undefined &&
      maxGuests === undefined &&
      basePrice === undefined
    ) {
      throw new BadRequestException('Khong co du lieu de cap nhat.');
    }

    if (name !== undefined) {
      await this.ensureNameIsAvailable(name, roomType.id);
      roomType.name = name;
    }

    if (description !== undefined) {
      roomType.description = description;
    }

    if (maxGuests !== undefined) {
      roomType.maxGuests = maxGuests;
    }

    if (basePrice !== undefined) {
      roomType.basePrice = basePrice;
    }

    try {
      return this.toAdminResponse(
        await this.roomTypesRepository.save(roomType),
      );
    } catch (error) {
      this.throwRoomTypeDuplicateConflict(error);
    }
  }

  async softDelete(id: string): Promise<AdminRoomTypeResponse> {
    const roomType = await this.getActiveRoomType(id);

    if (await this.hasActiveRooms(roomType.id)) {
      throw new ConflictException(
        'Khong the xoa loai phong dang duoc phong su dung.',
      );
    }

    return this.toAdminResponse(
      await this.roomTypesRepository.softRemove(roomType),
    );
  }

  async restore(id: string): Promise<AdminRoomTypeResponse> {
    const roomType = await this.getRoomTypeWithDeleted(id);

    if (roomType.deletedAt === null) {
      throw new BadRequestException('Loai phong chua bi xoa.');
    }

    await this.ensureNameIsAvailable(roomType.name, roomType.id);

    try {
      return this.toAdminResponse(
        await this.roomTypesRepository.recover(roomType),
      );
    } catch (error) {
      this.throwRoomTypeDuplicateConflict(error);
    }
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
      .orderBy('roomType.createdAt', 'DESC')
      .addOrderBy('roomType.id', 'DESC')
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
      meta: this.toPaginationMeta(page, limit, total),
    };
  }

  private async getActiveRoomType(id: string): Promise<RoomType> {
    this.validateId(id);

    const roomType = await this.roomTypesRepository.findOneBy({ id });

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
      .where('roomType.id = :id', { id })
      .getOne();

    if (roomType === null) {
      throw new NotFoundException('Khong tim thay loai phong.');
    }

    return roomType;
  }

  private async ensureNameIsAvailable(
    name: string,
    currentRoomTypeId?: string,
  ): Promise<void> {
    const query = this.roomTypesRepository
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

  private async hasActiveRooms(roomTypeId: string): Promise<boolean> {
    const room = await this.roomTypesRepository.manager
      .createQueryBuilder()
      .select('room.id', 'id')
      .from('rooms', 'room')
      .where('room.room_type_id = :roomTypeId', { roomTypeId })
      .andWhere('room.deleted_at IS NULL')
      .limit(1)
      .getRawOne<{ id: string }>();

    return room !== undefined && room !== null;
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

  private toPublicResponse(roomType: RoomType): RoomTypeResponse {
    return {
      id: roomType.id,
      name: roomType.name,
      description: roomType.description,
      maxGuests: roomType.maxGuests,
      basePrice: roomType.basePrice,
      createdAt: roomType.createdAt,
      updatedAt: roomType.updatedAt,
    };
  }

  private toAdminResponse(roomType: RoomType): AdminRoomTypeResponse {
    return {
      ...this.toPublicResponse(roomType),
      deletedAt: roomType.deletedAt,
    };
  }

  private toPaginationMeta(
    page: number,
    limit: number,
    total: number,
  ): PaginationMeta {
    return {
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
