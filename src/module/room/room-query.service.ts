import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { SelectQueryBuilder } from 'typeorm';
import { Repository } from 'typeorm';

import {
  optionalDecimalAmount,
  optionalSearch,
  parsePagination,
  requirePositiveInt,
} from '../../common/validation';
import type { ListAvailableRoomsQueryDto } from './dto/list-available-rooms-query.dto';
import type { ListManagementRoomsQueryDto } from './dto/list-management-rooms-query.dto';
import type { ListRoomsQueryDto } from './dto/list-rooms-query.dto';
import {
  RoomSearchSort,
  type SearchRoomsQueryDto,
} from './dto/search-rooms-query.dto';
import type { RoomImage } from './schema/room-image.entity';
import { Room, RoomStatus } from './schema/room.entity';
import {
  RoomCalendar,
  RoomCalendarStatus,
} from '../booking/schema/room-calendar.entity';
import type {
  ManagementRoomCalendarSummary,
  ManagementRoomListResult,
  RoomImageResponse,
  RoomListResult,
  PublicRoomListResult,
  PublicRoomResponse,
  RoomResponse,
} from './room.types';
import { RoomTodayAvailabilityStatus } from './room.types';

const VIETNAM_UTC_OFFSET_MILLISECONDS = 7 * 60 * 60 * 1000;

@Injectable()
export class RoomQueryService {
  constructor(
    @InjectRepository(Room)
    private readonly roomsRepository: Repository<Room>,
    @InjectRepository(RoomCalendar)
    private readonly roomCalendarsRepository: Repository<RoomCalendar>,
  ) {}

  async list(query: ListRoomsQueryDto): Promise<PublicRoomListResult> {
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
        '(LOWER(room.name) LIKE :search OR LOWER(room.description) LIKE :search)',
        { search: `%${search.toLowerCase()}%` },
      );
    }

    if (roomTypeId !== undefined) {
      roomsQuery.andWhere('room.roomTypeId = :roomTypeId', { roomTypeId });
    }

    return this.toListResult(roomsQuery, page, limit, (room) =>
      this.toPublicResponse(room),
    );
  }

  async listManagement(
    query: ListManagementRoomsQueryDto,
  ): Promise<ManagementRoomListResult> {
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

    const [rooms, total] = await roomsQuery.getManyAndCount();
    const calendarSummaries = await this.getCalendarSummaries(rooms);

    return {
      items: rooms.map((room) => ({
        ...this.toResponse(room),
        calendarSummary:
          calendarSummaries.get(room.id) ?? this.emptyCalendarSummary(),
      })),
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

  async listAvailable(
    query: ListAvailableRoomsQueryDto,
  ): Promise<RoomListResult> {
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
    const { page, limit, skip } = parsePagination(
      query as Record<string, unknown>,
    );
    const roomsQuery = this.createManagementQuery()
      .andWhere('room.status NOT IN (:...unbookableStatuses)', {
        unbookableStatuses: [RoomStatus.HIDDEN, RoomStatus.MAINTENANCE],
      })
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
      .orderBy('room.roomNumber', 'ASC')
      .addOrderBy('image.isCover', 'DESC')
      .addOrderBy('image.sortOrder', 'ASC')
      .addOrderBy('image.id', 'ASC')
      .skip(skip)
      .take(limit);

    if (roomTypeId !== undefined) {
      roomsQuery.andWhere('room.roomTypeId = :roomTypeId', { roomTypeId });
    }

    return this.toListResult(roomsQuery, page, limit, (room) =>
      this.toResponse(room),
    );
  }

  async search(query: SearchRoomsQueryDto): Promise<PublicRoomListResult> {
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
    const amenityIds = this.optionalIdList(
      query.amenityIds,
      'Danh sach tien nghi khong hop le.',
    );
    const sort = this.optionalRoomSearchSort(query.sort);
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
      .orderBy(this.roomSearchOrder(sort), this.roomSearchDirection(sort))
      .addOrderBy('roomType.basePrice', 'ASC')
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

    if (amenityIds.length > 0) {
      roomsQuery.andWhere(
        `room.room_type_id IN (
          SELECT roomTypeAmenity.room_type_id
          FROM room_type_amenities roomTypeAmenity
          INNER JOIN amenities amenityFilter
            ON amenityFilter.id = roomTypeAmenity.amenity_id
            AND amenityFilter.deleted_at IS NULL
          WHERE roomTypeAmenity.amenity_id IN (:...amenityIds)
          GROUP BY roomTypeAmenity.room_type_id
          HAVING COUNT(DISTINCT roomTypeAmenity.amenity_id) = :amenityCount
        )`,
        {
          amenityIds,
          amenityCount: amenityIds.length,
        },
      );
    }

    return this.toListResult(roomsQuery, page, limit, (room) =>
      this.toPublicResponse(room),
    );
  }

  private optionalRoomSearchSort(value: unknown): RoomSearchSort {
    if (value === undefined || value === null || value === '') {
      return RoomSearchSort.RECOMMENDED;
    }

    if (
      typeof value !== 'string' ||
      !Object.values(RoomSearchSort).includes(value as RoomSearchSort)
    ) {
      throw new BadRequestException('Sap xep phong khong hop le.');
    }

    return value as RoomSearchSort;
  }

  private roomSearchOrder(sort: RoomSearchSort): string {
    switch (sort) {
      case RoomSearchSort.PRICE_DESC:
      case RoomSearchSort.PRICE_ASC:
        return 'roomType.basePrice';
      case RoomSearchSort.NEWEST:
        return 'room.createdAt';
      case RoomSearchSort.POPULARITY:
        return `(SELECT COUNT(*) FROM bookings popularityBooking WHERE popularityBooking.room_id = room.id AND popularityBooking.status NOT IN ('CANCELLED', 'EXPIRED'))`;
      default:
        return 'roomType.basePrice';
    }
  }

  private roomSearchDirection(sort: RoomSearchSort): 'ASC' | 'DESC' {
    return sort === RoomSearchSort.PRICE_DESC ||
      sort === RoomSearchSort.NEWEST ||
      sort === RoomSearchSort.POPULARITY
      ? 'DESC'
      : 'ASC';
  }

  async getById(id: string): Promise<PublicRoomResponse> {
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

    return this.toPublicResponse(room);
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

  async getAdminRoom(id: string): Promise<RoomResponse> {
    return this.toResponse(await this.getAdminRoomEntity(id));
  }

  toResponse(room: Room): RoomResponse {
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
        bedType: room.roomType.bedType,
        maxGuests: room.roomType.maxGuests,
        basePrice: room.roomType.basePrice,
        amenities: (room.roomType.amenities ?? []).map((amenity) => ({
          id: amenity.id,
          name: amenity.name,
          description: amenity.description,
        })),
      },
      images: (room.images ?? []).map((image) => this.toImageResponse(image)),
      createdAt: room.createdAt,
      updatedAt: room.updatedAt,
    };
  }

  toPublicResponse(room: Room): PublicRoomResponse {
    return {
      id: room.id,
      roomTypeId: room.roomTypeId,
      name: room.name,
      description: room.description,
      roomType: {
        id: room.roomType.id,
        name: room.roomType.name,
        description: room.roomType.description,
        bedType: room.roomType.bedType,
        maxGuests: room.roomType.maxGuests,
        basePrice: room.roomType.basePrice,
        amenities: (room.roomType.amenities ?? []).map((amenity) => ({
          id: amenity.id,
          name: amenity.name,
          description: amenity.description,
        })),
      },
      images: (room.images ?? []).map((image) => this.toImageResponse(image)),
    };
  }

  private createPublicQuery(): SelectQueryBuilder<Room> {
    return this.roomsRepository
      .createQueryBuilder('room')
      .innerJoinAndSelect('room.roomType', 'roomType')
      .leftJoinAndSelect(
        'roomType.amenities',
        'amenity',
        'amenity.deletedAt IS NULL',
      )
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
      .leftJoinAndSelect(
        'roomType.amenities',
        'amenity',
        'amenity.deletedAt IS NULL',
      )
      .leftJoinAndSelect('room.images', 'image')
      .where('room.deletedAt IS NULL')
      .andWhere('roomType.deletedAt IS NULL');
  }

  private async getCalendarSummaries(
    rooms: Room[],
  ): Promise<Map<string, ManagementRoomCalendarSummary>> {
    const asOfDate = this.getCurrentVietnamDate();

    if (rooms.length === 0) {
      return new Map();
    }

    const roomIds = rooms.map((room) => room.id);
    const nextEvents = await this.roomCalendarsRepository
      .createQueryBuilder('calendar')
      .leftJoinAndSelect('calendar.booking', 'booking')
      .where('calendar.roomId IN (:...roomIds)', { roomIds })
      .andWhere('calendar.stayDate >= :asOfDate', { asOfDate })
      .andWhere(
        `calendar.stayDate = (
          SELECT MIN(nextCalendar.stay_date)
          FROM room_calendar nextCalendar
          WHERE nextCalendar.room_id = calendar.room_id
            AND nextCalendar.stay_date >= :asOfDate
        )`,
        { asOfDate },
      )
      .orderBy('calendar.roomId', 'ASC')
      .addOrderBy('calendar.stayDate', 'ASC')
      .getMany();
    const eventByRoomId = new Map(
      nextEvents.map((event) => [event.roomId, event]),
    );

    return new Map(
      rooms.map((room) => {
        const event = eventByRoomId.get(room.id);
        const summary: ManagementRoomCalendarSummary = {
          asOfDate,
          todayStatus:
            event?.stayDate === asOfDate
              ? event.status === RoomCalendarStatus.RESERVED
                ? RoomTodayAvailabilityStatus.RESERVED
                : RoomTodayAvailabilityStatus.BLOCKED
              : RoomTodayAvailabilityStatus.AVAILABLE,
          nextEvent:
            event === undefined
              ? null
              : {
                  stayDate: event.stayDate,
                  status: event.status,
                  reason: event.reason,
                  booking:
                    event.booking === null
                      ? null
                      : {
                          id: event.booking.id,
                          bookingCode: event.booking.bookingCode,
                          checkInDate: event.booking.checkInDate,
                          checkOutDate: event.booking.checkOutDate,
                        },
                },
        };

        return [room.id, summary];
      }),
    );
  }

  private emptyCalendarSummary(): ManagementRoomCalendarSummary {
    return {
      asOfDate: this.getCurrentVietnamDate(),
      todayStatus: RoomTodayAvailabilityStatus.AVAILABLE,
      nextEvent: null,
    };
  }

  private getCurrentVietnamDate(now = new Date()): string {
    return new Date(now.getTime() + VIETNAM_UTC_OFFSET_MILLISECONDS)
      .toISOString()
      .slice(0, 10);
  }

  private async getAdminRoomEntity(id: string): Promise<Room> {
    this.validateId(id);

    const room = await this.roomsRepository
      .createQueryBuilder('room')
      .innerJoinAndSelect('room.roomType', 'roomType')
      .leftJoinAndSelect(
        'roomType.amenities',
        'amenity',
        'amenity.deletedAt IS NULL',
      )
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

  private async toListResult<TItem>(
    query: SelectQueryBuilder<Room>,
    page: number,
    limit: number,
    mapRoom: (room: Room) => TItem,
  ): Promise<RoomListResult<TItem>> {
    const [rooms, total] = await query.getManyAndCount();

    return {
      items: rooms.map(mapRoom),
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

  private optionalIdList(value: unknown, message: string): string[] {
    if (value === undefined || value === null || value === '') {
      return [];
    }

    const values = Array.isArray(value) ? value : [value];
    const ids = values.flatMap((item) =>
      typeof item === 'string' ? item.split(',') : [],
    );

    if (
      ids.length === 0 ||
      ids.length > 20 ||
      ids.some((id) => !/^[1-9][0-9]*$/.test(id))
    ) {
      throw new BadRequestException(message);
    }

    return [...new Set(ids)];
  }

  private validateId(id: string): void {
    this.requireId(id, 'Id khong hop le.');
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
}
