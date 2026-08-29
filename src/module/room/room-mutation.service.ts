import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { EntityManager } from 'typeorm';
import { IsNull, Repository } from 'typeorm';

import { getMysqlDuplicateKey } from '../../common/database';
import type { UserRole } from '../../common/domain/account.enums';
import {
  optionalNullableTrimmedString,
  optionalTrimmedString,
  requireTrimmedString,
} from '../../common/validation';
import {
  AuditLogService,
  type AuditActorContext,
} from '../audit/audit-log.service';
import { AuditAction, AuditEntityType } from '../audit/domain/audit-log';
import { Booking } from '../booking/schema/booking.entity';
import { BookingStatus } from '../booking/domain/booking-state';
import { RoomType } from '../room-type/schema/room-type.entity';
import type { CreateRoomDto } from './dto/create-room.dto';
import type { UpdateRoomStatusDto } from './dto/update-room-status.dto';
import type { UpdateRoomDto } from './dto/update-room.dto';
import { RoomImageStorageService } from './room-image-storage.service';
import { RoomQueryService } from './room-query.service';
import { RoomStatusTransitionPolicy } from './domain/room-status-transition.policy';
import type { RoomStatusTransitionContext } from './domain/room-status-transition.policy';
import { throwMappedRoomDomainError } from './room-domain-error.mapper';
import { Room } from './schema/room.entity';
import { RoomStatus } from './domain/room-status';
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
    private readonly roomStatusTransitionPolicy: RoomStatusTransitionPolicy,
    private readonly auditLogService: AuditLogService,
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

    this.assertStatusTransitionAllowed({
      currentStatus: RoomStatus.READY,
      nextStatus: status,
      role: 'ADMIN',
      hasCheckedInBooking: false,
    });

    try {
      const roomId = await this.roomsRepository.manager.transaction(
        async (manager) => {
          await this.getLockedActiveRoomType(manager, roomTypeId);
          await this.ensureRoomNumberIsAvailable(
            roomNumber,
            undefined,
            manager,
          );

          const roomsRepository = manager.getRepository(Room);
          const room = roomsRepository.create({
            roomTypeId,
            roomNumber,
            name,
            description,
            status,
          });

          return (await roomsRepository.save(room)).id;
        },
      );

      return this.roomQueryService.getAdminRoom(roomId);
    } catch (error) {
      this.throwRoomDuplicateConflict(error);
    }
  }

  async update(id: string, body: UpdateRoomDto): Promise<RoomResponse> {
    this.validateId(id);
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

    try {
      const roomId = await this.roomsRepository.manager.transaction(
        async (manager) => {
          if (roomTypeId !== undefined) {
            await this.getLockedActiveRoomType(manager, roomTypeId);
          }

          const room = await this.getLockedRoomForMutation(manager, id);

          if (roomTypeId !== undefined) {
            changes.roomTypeId = roomTypeId;
          }

          if (roomNumber !== undefined) {
            await this.ensureRoomNumberIsAvailable(
              roomNumber,
              room.id,
              manager,
            );
            changes.roomNumber = roomNumber;
          }

          if (name !== undefined) {
            changes.name = name;
          }

          if (description !== undefined) {
            changes.description = description;
          }

          const result = await manager
            .getRepository(Room)
            .update({ id: room.id, deletedAt: IsNull() }, changes);

          if (result.affected !== 1) {
            throw new ConflictException(
              'Phong da thay doi. Vui long tai lai va thu lai.',
            );
          }

          return room.id;
        },
      );

      return this.roomQueryService.getAdminRoom(roomId);
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
    auditContext: AuditActorContext,
  ): Promise<RoomResponse> {
    this.validateId(id);
    const status = this.requireStatus(body.status);
    const roomId = await this.roomsRepository.manager.transaction(
      // A no-match locking read must not gap-lock new Booking inserts while
      // this transaction waits for the Room row.
      'READ COMMITTED',
      async (manager) => {
        // Booking lifecycle also locks Booking before Room. Locking every
        // CONFIRMED/CHECKED_IN candidate closes the race where a check-in and
        // a manual Room transition start at the same time.
        const hasCheckedInBooking = await this.lockStayBookings(manager, id);
        const room = await this.getLockedRoomForStatus(manager, id);

        this.assertStatusTransitionAllowed({
          currentStatus: room.status,
          nextStatus: status,
          role,
          hasCheckedInBooking,
        });

        if (room.status === status) {
          return room.id;
        }

        const result = await manager.getRepository(Room).update(
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

        await this.auditLogService.record(manager, {
          ...auditContext,
          action: AuditAction.ROOM_STATUS_CHANGED,
          entityType: AuditEntityType.ROOM,
          entityId: room.id,
          metadata: {
            fromStatus: room.status,
            toStatus: status,
          },
        });

        return room.id;
      },
    );

    return this.roomQueryService.getAdminRoom(roomId);
  }

  private assertStatusTransitionAllowed(
    context: RoomStatusTransitionContext,
  ): void {
    try {
      this.roomStatusTransitionPolicy.assertAllowed(context);
    } catch (error) {
      throwMappedRoomDomainError(error);
    }
  }

  private async lockStayBookings(
    manager: EntityManager,
    roomId: string,
  ): Promise<boolean> {
    const bookings = await manager
      .getRepository(Booking)
      .createQueryBuilder('booking')
      .select(['booking.id', 'booking.status'])
      .where('booking.roomId = :roomId', { roomId })
      .andWhere('booking.status IN (:...statuses)', {
        statuses: [BookingStatus.CONFIRMED, BookingStatus.CHECKED_IN],
      })
      .orderBy('booking.id', 'ASC')
      .setLock('pessimistic_write')
      .getMany();

    return bookings.some(
      (booking) => booking.status === BookingStatus.CHECKED_IN,
    );
  }

  private async getLockedRoomForStatus(
    manager: EntityManager,
    id: string,
  ): Promise<Room> {
    const room = await manager
      .getRepository(Room)
      .createQueryBuilder('room')
      .where('room.id = :id', { id })
      .andWhere('room.deletedAt IS NULL')
      .setLock('pessimistic_write')
      .getOne();

    if (room === null) {
      throw new NotFoundException('Khong tim thay phong.');
    }

    return room;
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
      .leftJoinAndSelect('roomType.beds', 'bed')
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

  private async getLockedActiveRoomType(
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

  private async getLockedRoomForMutation(
    manager: EntityManager,
    id: string,
  ): Promise<Room> {
    const room = await manager
      .getRepository(Room)
      .createQueryBuilder('room')
      .withDeleted()
      .where('room.id = :id', { id })
      .setLock('pessimistic_write')
      .getOne();

    if (room === null || room.deletedAt !== null) {
      throw new NotFoundException('Khong tim thay phong.');
    }

    return room;
  }

  private async ensureRoomNumberIsAvailable(
    roomNumber: string,
    currentRoomId?: string,
    manager: EntityManager = this.roomsRepository.manager,
  ): Promise<void> {
    const query = manager
      .getRepository(Room)
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
