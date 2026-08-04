import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager } from 'typeorm';
import { IsNull, Repository } from 'typeorm';

import { getMysqlDuplicateKey } from '../../common/database';
import type { UserRole } from '../../common/http';
import {
  optionalNullableTrimmedString,
  optionalTrimmedString,
  requireTrimmedString,
} from '../../common/validation';
import { RoomType } from '../room-type/schema/room-type.entity';
import type { CreateRoomDto } from './dto/create-room.dto';
import type { UpdateRoomStatusDto } from './dto/update-room-status.dto';
import type { UpdateRoomDto } from './dto/update-room.dto';
import { RoomImageStorageService } from './room-image-storage.service';
import { RoomQueryService } from './room-query.service';
import { Room, RoomStatus } from './schema/room.entity';
import type { RoomResponse } from './room.types';

@Injectable()
export class RoomMutationService {
  constructor(
    @InjectRepository(Room)
    private readonly roomsRepository: Repository<Room>,
    @InjectRepository(RoomType)
    private readonly roomTypesRepository: Repository<RoomType>,
    private readonly roomImageStorage: RoomImageStorageService,
    private readonly roomQueryService: RoomQueryService,
  ) {}

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
      return this.roomQueryService.getAdminRoom(savedRoom.id);
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

    const changes: {
      roomTypeId?: string;
      roomNumber?: string;
      name?: string;
      description?: string | null;
    } = {};

    if (roomTypeId !== undefined) {
      await this.getActiveRoomType(roomTypeId);
      changes.roomTypeId = roomTypeId;
    }

    if (roomNumber !== undefined) {
      await this.ensureRoomNumberIsAvailable(roomNumber, room.id);
      changes.roomNumber = roomNumber;
    }

    if (name !== undefined) {
      changes.name = name;
    }

    if (description !== undefined) {
      changes.description = description;
    }

    try {
      const result = await this.roomsRepository.update(
        { id: room.id, deletedAt: IsNull() },
        changes,
      );

      if (result.affected !== 1) {
        throw new ConflictException(
          'Phong da thay doi. Vui long tai lai va thu lai.',
        );
      }

      return this.roomQueryService.getAdminRoom(room.id);
    } catch (error) {
      this.throwRoomDuplicateConflict(error);
    }
  }

  async delete(id: string): Promise<RoomResponse> {
    this.validateId(id);
    const result = await this.roomsRepository.manager.transaction(
      async (manager) => {
        const room = await this.getLockedAdminRoomEntity(manager, id);

        if (await this.hasHistory(room.id, manager)) {
          throw new ConflictException(
            'Phong da co lich su dat phong. Hay chuyen trang thai sang HIDDEN.',
          );
        }

        const response = this.roomQueryService.toResponse(room);
        const imageUrls = room.images.map((image) => image.imageUrl);

        await manager.getRepository(Room).remove(room);

        return { imageUrls, response };
      },
    );
    await Promise.all(
      result.imageUrls.map((imageUrl) =>
        this.roomImageStorage.deleteManaged(imageUrl),
      ),
    );

    return result.response;
  }

  async updateStatus(
    id: string,
    body: UpdateRoomStatusDto,
    role: UserRole | undefined,
  ): Promise<RoomResponse> {
    const room = await this.getActiveRoom(id);
    const status = this.requireStatus(body.status);

    this.assertStatusTransitionAllowed(room.status, status, role);

    const result = await this.roomsRepository.update(
      {
        id: room.id,
        status: room.status,
        deletedAt: IsNull(),
      },
      { status },
    );

    if (result.affected !== 1) {
      throw new ConflictException(
        'Trang thai phong da thay doi. Vui long tai lai va thu lai.',
      );
    }

    return this.roomQueryService.getAdminRoom(room.id);
  }

  private async getLockedAdminRoomEntity(
    manager: EntityManager,
    id: string,
  ): Promise<Room> {
    const room = await manager
      .getRepository(Room)
      .createQueryBuilder('room')
      .innerJoinAndSelect('room.roomType', 'roomType')
      .leftJoinAndSelect(
        'roomType.amenities',
        'amenity',
        'amenity.deletedAt IS NULL',
      )
      .leftJoinAndSelect('room.images', 'image')
      .setLock('pessimistic_write')
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

  private async hasHistory(
    roomId: string,
    manager: EntityManager = this.roomsRepository.manager,
  ): Promise<boolean> {
    const [booking, calendarEntry] = await Promise.all([
      manager
        .createQueryBuilder()
        .select('booking.id', 'id')
        .from('bookings', 'booking')
        .where('booking.room_id = :roomId', { roomId })
        .limit(1)
        .getRawOne<{ id: string }>(),
      manager
        .createQueryBuilder()
        .select('roomCalendar.id', 'id')
        .from('room_calendar', 'roomCalendar')
        .where('roomCalendar.room_id = :roomId', { roomId })
        .limit(1)
        .getRawOne<{ id: string }>(),
    ]);

    return booking != null || calendarEntry != null;
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
