import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { SelectQueryBuilder } from 'typeorm';
import { Repository } from 'typeorm';

import { getMysqlDuplicateKey } from '../../common/database';
import type { PaginationMeta, UserRole } from '../../common/http';
import {
  optionalDecimalAmount,
  optionalNullableTrimmedString,
  optionalSearch,
  optionalTrimmedString,
  parsePagination,
  requirePositiveInt,
  requireTrimmedString,
} from '../../common/validation';
import { RoomType } from '../room-type/schema/room-type.entity';
import { CreateRoomDto } from './dto/create-room.dto';
import { ListManagementRoomsQueryDto } from './dto/list-management-rooms-query.dto';
import { ListRoomsQueryDto } from './dto/list-rooms-query.dto';
import { SearchRoomsQueryDto } from './dto/search-rooms-query.dto';
import { UpdateRoomStatusDto } from './dto/update-room-status.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { RoomImage } from './schema/room-image.entity';
import { Room, RoomStatus } from './schema/room.entity';

export interface RoomImageResponse {
  id: string;
  imageUrl: string;
  sortOrder: number;
  isCover: boolean;
}

export interface RoomResponse {
  id: string;
  roomTypeId: string;
  roomNumber: string;
  name: string;
  description: string | null;
  status: RoomStatus;
  roomType: {
    id: string;
    name: string;
    description: string | null;
    maxGuests: number;
    basePrice: string;
  };
  images: RoomImageResponse[];
  createdAt: Date;
  updatedAt: Date;
}

interface RoomListResult {
  items: RoomResponse[];
  meta: PaginationMeta;
}

@Injectable()
export class RoomService {
  constructor(
    @InjectRepository(Room)
    private readonly roomsRepository: Repository<Room>,
    @InjectRepository(RoomType)
    private readonly roomTypesRepository: Repository<RoomType>,
  ) {}

  async list(query: ListRoomsQueryDto): Promise<RoomListResult> {
    const { page, limit, skip } = parsePagination(
      query as Record<string, unknown>,
    );
    const search = optionalSearch(query.search);
    const roomTypeId = this.optionalId(
      query.roomTypeId,
      'Room type id khong hop le.',
    );
    const roomsQuery = this.createPublicQuery()
      .orderBy('room.roomNumber', 'ASC')
      .addOrderBy('image.isCover', 'DESC')
      .addOrderBy('image.sortOrder', 'ASC')
      .addOrderBy('image.id', 'ASC')
      .skip(skip)
      .take(limit);

    if (search !== undefined) {
      roomsQuery.andWhere(
        '(LOWER(room.name) LIKE :search OR LOWER(room.roomNumber) LIKE :search OR LOWER(room.description) LIKE :search)',
        { search: `%${search.toLowerCase()}%` },
      );
    }

    if (roomTypeId !== undefined) {
      roomsQuery.andWhere('room.roomTypeId = :roomTypeId', { roomTypeId });
    }

    return this.toListResult(roomsQuery, page, limit);
  }

  async listManagement(
    query: ListManagementRoomsQueryDto,
  ): Promise<RoomListResult> {
    const { page, limit, skip } = parsePagination(
      query as Record<string, unknown>,
    );
    const search = optionalSearch(query.search);
    const roomTypeId = this.optionalId(
      query.roomTypeId,
      'Room type id khong hop le.',
    );
    const status = this.optionalStatus(query.status);
    const roomsQuery = this.createManagementQuery()
      .orderBy('room.roomNumber', 'ASC')
      .addOrderBy('image.isCover', 'DESC')
      .addOrderBy('image.sortOrder', 'ASC')
      .addOrderBy('image.id', 'ASC')
      .skip(skip)
      .take(limit);

    if (search !== undefined) {
      roomsQuery.andWhere(
        '(LOWER(room.name) LIKE :search OR LOWER(room.roomNumber) LIKE :search OR LOWER(room.description) LIKE :search)',
        { search: `%${search.toLowerCase()}%` },
      );
    }

    if (roomTypeId !== undefined) {
      roomsQuery.andWhere('room.roomTypeId = :roomTypeId', { roomTypeId });
    }

    if (status !== undefined) {
      roomsQuery.andWhere('room.status = :status', { status });
    }

    return this.toListResult(roomsQuery, page, limit);
  }

  async search(query: SearchRoomsQueryDto): Promise<RoomListResult> {
    const checkIn = this.requireIsoDate(
      query.checkIn,
      'Ngay check-in khong hop le.',
    );
    const checkOut = this.requireIsoDate(
      query.checkOut,
      'Ngay check-out khong hop le.',
    );

    if (checkIn >= checkOut) {
      throw new BadRequestException('Ngay check-out phai sau ngay check-in.');
    }

    const guests = requirePositiveInt(
      query.guests,
      'So luong khach khong hop le.',
    );
    const roomTypeId = this.optionalId(
      query.roomTypeId,
      'Room type id khong hop le.',
    );
    const minPrice = optionalDecimalAmount(
      query.minPrice,
      'Gia toi thieu khong hop le.',
    );
    const maxPrice = optionalDecimalAmount(
      query.maxPrice,
      'Gia toi da khong hop le.',
    );
    const { page, limit, skip } = parsePagination(
      query as Record<string, unknown>,
    );

    if (
      minPrice !== undefined &&
      maxPrice !== undefined &&
      Number(minPrice) > Number(maxPrice)
    ) {
      throw new BadRequestException(
        'Gia toi da phai lon hon hoac bang gia toi thieu.',
      );
    }

    const roomsQuery = this.createPublicQuery()
      .andWhere('roomType.maxGuests >= :guests', { guests })
      .andWhere(
        `NOT EXISTS (
          SELECT 1
          FROM room_calendar roomCalendar
          WHERE roomCalendar.room_id = room.id
            AND roomCalendar.stay_date >= :checkIn
            AND roomCalendar.stay_date < :checkOut
        )`,
        { checkIn, checkOut },
      )
      .orderBy('roomType.basePrice', 'ASC')
      .addOrderBy('room.roomNumber', 'ASC')
      .addOrderBy('image.isCover', 'DESC')
      .addOrderBy('image.sortOrder', 'ASC')
      .addOrderBy('image.id', 'ASC')
      .skip(skip)
      .take(limit);

    if (roomTypeId !== undefined) {
      roomsQuery.andWhere('room.roomTypeId = :roomTypeId', { roomTypeId });
    }

    if (minPrice !== undefined) {
      roomsQuery.andWhere('roomType.basePrice >= :minPrice', { minPrice });
    }

    if (maxPrice !== undefined) {
      roomsQuery.andWhere('roomType.basePrice <= :maxPrice', { maxPrice });
    }

    return this.toListResult(roomsQuery, page, limit);
  }

  async getById(id: string): Promise<RoomResponse> {
    this.validateId(id);

    const room = await this.createPublicQuery()
      .andWhere('room.id = :id', { id })
      .orderBy('image.isCover', 'DESC')
      .addOrderBy('image.sortOrder', 'ASC')
      .addOrderBy('image.id', 'ASC')
      .getOne();

    if (room === null) {
      throw new NotFoundException('Khong tim thay phong.');
    }

    return this.toResponse(room);
  }

  async getManagement(id: string): Promise<RoomResponse> {
    this.validateId(id);

    const room = await this.createManagementQuery()
      .andWhere('room.id = :id', { id })
      .orderBy('image.isCover', 'DESC')
      .addOrderBy('image.sortOrder', 'ASC')
      .addOrderBy('image.id', 'ASC')
      .getOne();

    if (room === null) {
      throw new NotFoundException('Khong tim thay phong.');
    }

    return this.toResponse(room);
  }

  async create(body: CreateRoomDto): Promise<RoomResponse> {
    const roomTypeId = this.requireId(
      body.roomTypeId,
      'Room type id khong hop le.',
    );
    const roomNumber = requireTrimmedString(
      body.roomNumber,
      'So phong khong hop le.',
      50,
    );
    const name = requireTrimmedString(
      body.name,
      'Ten phong khong hop le.',
      120,
    );
    const description =
      optionalNullableTrimmedString(
        body.description,
        'Mo ta khong hop le.',
        10000,
      ) ?? null;
    const status = this.optionalStatus(body.status) ?? RoomStatus.READY;

    await this.getActiveRoomType(roomTypeId);
    await this.ensureRoomNumberIsAvailable(roomNumber);

    const room = this.roomsRepository.create({
      roomTypeId,
      roomNumber,
      name,
      description,
      status,
    });

    try {
      const savedRoom = await this.roomsRepository.save(room);
      return this.getAdminRoom(savedRoom.id);
    } catch (error) {
      this.throwRoomDuplicateConflict(error);
    }
  }

  async update(id: string, body: UpdateRoomDto): Promise<RoomResponse> {
    const room = await this.getActiveRoom(id);
    const roomTypeId = this.optionalId(
      body.roomTypeId,
      'Room type id khong hop le.',
    );
    const roomNumber = optionalTrimmedString(
      body.roomNumber,
      'So phong khong hop le.',
      50,
    );
    const name = optionalTrimmedString(
      body.name,
      'Ten phong khong hop le.',
      120,
    );
    const description = optionalNullableTrimmedString(
      body.description,
      'Mo ta khong hop le.',
      10000,
    );

    if (
      roomTypeId === undefined &&
      roomNumber === undefined &&
      name === undefined &&
      description === undefined
    ) {
      throw new BadRequestException('Khong co du lieu de cap nhat.');
    }

    if (roomTypeId !== undefined) {
      await this.getActiveRoomType(roomTypeId);
      room.roomTypeId = roomTypeId;
    }

    if (roomNumber !== undefined) {
      await this.ensureRoomNumberIsAvailable(roomNumber, room.id);
      room.roomNumber = roomNumber;
    }

    if (name !== undefined) {
      room.name = name;
    }

    if (description !== undefined) {
      room.description = description;
    }

    try {
      await this.roomsRepository.save(room);
      return this.getAdminRoom(room.id);
    } catch (error) {
      this.throwRoomDuplicateConflict(error);
    }
  }

  async delete(id: string): Promise<RoomResponse> {
    const room = await this.getAdminRoomEntity(id);

    if (await this.hasHistory(room.id)) {
      throw new ConflictException(
        'Phong da co lich su dat phong. Hay chuyen trang thai sang HIDDEN.',
      );
    }

    const response = this.toResponse(room);
    await this.roomsRepository.remove(room);

    return response;
  }

  async updateStatus(
    id: string,
    body: UpdateRoomStatusDto,
    role: UserRole | undefined,
  ): Promise<RoomResponse> {
    const room = await this.getActiveRoom(id);
    const status = this.requireStatus(body.status);

    this.assertStatusTransitionAllowed(room.status, status, role);

    room.status = status;
    await this.roomsRepository.save(room);

    return this.getAdminRoom(room.id);
  }

  private createPublicQuery(): SelectQueryBuilder<Room> {
    return this.roomsRepository
      .createQueryBuilder('room')
      .innerJoinAndSelect('room.roomType', 'roomType')
      .leftJoinAndSelect('room.images', 'image')
      .where('room.deletedAt IS NULL')
      .andWhere('roomType.deletedAt IS NULL')
      .andWhere('room.status NOT IN (:...hiddenStatuses)', {
        hiddenStatuses: [RoomStatus.HIDDEN, RoomStatus.MAINTENANCE],
      });
  }

  private createManagementQuery(): SelectQueryBuilder<Room> {
    return this.roomsRepository
      .createQueryBuilder('room')
      .innerJoinAndSelect('room.roomType', 'roomType')
      .leftJoinAndSelect('room.images', 'image')
      .where('room.deletedAt IS NULL')
      .andWhere('roomType.deletedAt IS NULL');
  }

  private async getAdminRoom(id: string): Promise<RoomResponse> {
    return this.toResponse(await this.getAdminRoomEntity(id));
  }

  private async getAdminRoomEntity(id: string): Promise<Room> {
    this.validateId(id);

    const room = await this.roomsRepository
      .createQueryBuilder('room')
      .innerJoinAndSelect('room.roomType', 'roomType')
      .leftJoinAndSelect('room.images', 'image')
      .where('room.id = :id', { id })
      .andWhere('room.deletedAt IS NULL')
      .orderBy('image.isCover', 'DESC')
      .addOrderBy('image.sortOrder', 'ASC')
      .addOrderBy('image.id', 'ASC')
      .getOne();

    if (room === null) {
      throw new NotFoundException('Khong tim thay phong.');
    }

    return room;
  }

  private async getActiveRoom(id: string): Promise<Room> {
    this.validateId(id);

    const room = await this.roomsRepository.findOneBy({ id });

    if (room === null) {
      throw new NotFoundException('Khong tim thay phong.');
    }

    return room;
  }

  private async getActiveRoomType(id: string): Promise<RoomType> {
    const roomType = await this.roomTypesRepository.findOneBy({ id });

    if (roomType === null) {
      throw new NotFoundException('Khong tim thay loai phong.');
    }

    return roomType;
  }

  private async ensureRoomNumberIsAvailable(
    roomNumber: string,
    currentRoomId?: string,
  ): Promise<void> {
    const query = this.roomsRepository
      .createQueryBuilder('room')
      .withDeleted()
      .where('room.roomNumber = :roomNumber', { roomNumber });

    if (currentRoomId !== undefined) {
      query.andWhere('room.id <> :currentRoomId', { currentRoomId });
    }

    if ((await query.getOne()) !== null) {
      throw new ConflictException(
        'So phong da ton tai, ke ca trong du lieu da xoa.',
      );
    }
  }

  private async hasHistory(roomId: string): Promise<boolean> {
    const [booking, calendarEntry] = await Promise.all([
      this.roomsRepository.manager
        .createQueryBuilder()
        .select('booking.id', 'id')
        .from('bookings', 'booking')
        .where('booking.room_id = :roomId', { roomId })
        .limit(1)
        .getRawOne<{ id: string }>(),
      this.roomsRepository.manager
        .createQueryBuilder()
        .select('roomCalendar.id', 'id')
        .from('room_calendar', 'roomCalendar')
        .where('roomCalendar.room_id = :roomId', { roomId })
        .limit(1)
        .getRawOne<{ id: string }>(),
    ]);

    return booking != null || calendarEntry != null;
  }

  private async toListResult(
    query: SelectQueryBuilder<Room>,
    page: number,
    limit: number,
  ): Promise<RoomListResult> {
    const [rooms, total] = await query.getManyAndCount();

    return {
      items: rooms.map((room) => this.toResponse(room)),
      meta: {
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    };
  }

  private toResponse(room: Room): RoomResponse {
    return {
      id: room.id,
      roomTypeId: room.roomTypeId,
      roomNumber: room.roomNumber,
      name: room.name,
      description: room.description,
      status: room.status,
      roomType: {
        id: room.roomType.id,
        name: room.roomType.name,
        description: room.roomType.description,
        maxGuests: room.roomType.maxGuests,
        basePrice: room.roomType.basePrice,
      },
      images: (room.images ?? []).map((image) => this.toImageResponse(image)),
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
    };
  }

  private toImageResponse(image: RoomImage): RoomImageResponse {
    return {
      id: image.id,
      imageUrl: image.imageUrl,
      sortOrder: image.sortOrder,
      isCover: image.isCover,
    };
  }

  private requireIsoDate(value: unknown, message: string): string {
    if (typeof value !== 'string') {
      throw new BadRequestException(message);
    }

    const date = value.trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);

    if (match === null) {
      throw new BadRequestException(message);
    }

    const parsed = new Date(`${date}T00:00:00.000Z`);

    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.getUTCFullYear() !== Number(match[1]) ||
      parsed.getUTCMonth() + 1 !== Number(match[2]) ||
      parsed.getUTCDate() !== Number(match[3])
    ) {
      throw new BadRequestException(message);
    }

    return date;
  }

  private requireId(value: unknown, message: string): string {
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new BadRequestException(message);
    }

    const id = String(value);

    if (!/^[1-9][0-9]*$/.test(id)) {
      throw new BadRequestException(message);
    }

    return id;
  }

  private optionalId(value: unknown, message: string): string | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    return this.requireId(value, message);
  }

  private validateId(id: string): void {
    this.requireId(id, 'Id khong hop le.');
  }

  private requireStatus(value: unknown): RoomStatus {
    const status = this.optionalStatus(value);

    if (status === undefined) {
      throw new BadRequestException('Trang thai phong khong hop le.');
    }

    return status;
  }

  private assertStatusTransitionAllowed(
    currentStatus: RoomStatus,
    nextStatus: RoomStatus,
    role: UserRole | undefined,
  ): void {
    if (role === 'ADMIN') {
      return;
    }

    if (
      role !== 'STAFF' ||
      currentStatus === RoomStatus.HIDDEN ||
      nextStatus === RoomStatus.HIDDEN
    ) {
      throw new ForbiddenException(
        'Chi admin duoc thay doi trang thai HIDDEN.',
      );
    }
  }

  private optionalStatus(value: unknown): RoomStatus | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    if (
      typeof value !== 'string' ||
      !Object.values(RoomStatus).includes(value as RoomStatus)
    ) {
      throw new BadRequestException('Trang thai phong khong hop le.');
    }

    return value as RoomStatus;
  }

  private throwRoomDuplicateConflict(error: unknown): never {
    if (getMysqlDuplicateKey(error) === undefined) {
      throw error;
    }

    throw new ConflictException(
      'So phong da ton tai, ke ca trong du lieu da xoa.',
    );
  }
}
