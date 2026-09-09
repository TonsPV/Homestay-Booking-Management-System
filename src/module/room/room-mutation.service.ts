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
  optionalEnumValue,
  optionalId,
  optionalNullableTrimmedString,
  optionalTrimmedString,
  requireEnumValue,
  requireId,
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
    private readonly roomRepo: Repository<Room>,
    @InjectRepository(RoomType)
    private readonly roomTypeRepo: Repository<RoomType>,
    private readonly imageStorage: RoomImageStorageService,
    private readonly roomQuery: RoomQueryService,
    private readonly statusPolicy: RoomStatusTransitionPolicy,
    private readonly auditLogService: AuditLogService,
  ) {}

  async create(body: CreateRoomDto): Promise<RoomResponse> {
    const roomTypeId = requireId(body.roomTypeId, 'Room type');
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
    const status =
      optionalEnumValue(
        body.status,
        RoomStatus,
        'Trang thai phong khong hop le.',
      ) ?? RoomStatus.READY;

    this.assertTransitionAllowed({
      currentStatus: RoomStatus.READY,
      nextStatus: status,
      role: 'ADMIN',
      hasCheckedInBooking: false,
    });

    try {
      const roomId = await this.roomRepo.manager.transaction(
        async (manager) => {
          await this.lockActiveRoomType(manager, roomTypeId);
          await this.assertNumberAvailable(roomNumber, undefined, manager);

          const roomRepo = manager.getRepository(Room);
          const room = roomRepo.create({
            roomTypeId,
            roomNumber,
            name,
            description,
            status,
          });

          return (await roomRepo.save(room)).id;
        },
      );

      return this.roomQuery.getAdminRoom(roomId);
    } catch (error) {
      this.throwDuplicateConflict(error);
    }
  }

  async update(id: string, body: UpdateRoomDto): Promise<RoomResponse> {
    requireId(id, '');
    const roomTypeId = optionalId(body.roomTypeId, 'Room type');
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
      const roomId = await this.roomRepo.manager.transaction(
        async (manager) => {
          if (roomTypeId !== undefined) {
            await this.lockActiveRoomType(manager, roomTypeId);
          }

          const room = await this.lockActiveRoomForMutation(manager, id);

          if (roomTypeId !== undefined) {
            changes.roomTypeId = roomTypeId;
          }

          if (roomNumber !== undefined) {
            await this.assertNumberAvailable(roomNumber, room.id, manager);
            changes.roomNumber = roomNumber;
          }

          if (name !== undefined) {
            changes.name = name;
          }

          if (description !== undefined) {
            changes.description = description;
          }

          const updateResult = await manager
            .getRepository(Room)
            .update({ id: room.id, deletedAt: IsNull() }, changes);

          if (updateResult.affected !== 1) {
            throw new ConflictException(
              'Phong da thay doi. Vui long tai lai va thu lai.',
            );
          }

          return room.id;
        },
      );

      return this.roomQuery.getAdminRoom(roomId);
    } catch (error) {
      this.throwDuplicateConflict(error);
    }
  }

  async delete(id: string): Promise<RoomResponse> {
    requireId(id, '');
    const deletionResult = await this.roomRepo.manager.transaction(
      async (manager) => {
        const room = await this.lockAdminRoom(manager, id);

        if (await this.hasRoomHistory(room.id, manager)) {
          throw new ConflictException(
            'Phong da co lich su dat phong. Hay chuyen trang thai sang HIDDEN.',
          );
        }

        const roomResponse = this.roomQuery.toManagementResponse(room);
        const imageUrls = room.images.map((image) => image.imageUrl);

        await manager.getRepository(Room).remove(room);

        return { imageUrls, roomResponse };
      },
    );
    await Promise.all(
      deletionResult.imageUrls.map((imageUrl) =>
        this.imageStorage.deleteManaged(imageUrl),
      ),
    );

    return deletionResult.roomResponse;
  }

  async updateStatus(
    id: string,
    body: UpdateRoomStatusDto,
    role: UserRole | undefined,
    auditContext: AuditActorContext,
  ): Promise<RoomResponse> {
    requireId(id, '');
    const status = requireEnumValue(
      body.status,
      RoomStatus,
      'Trang thai phong khong hop le.',
    );
    const roomId = await this.roomRepo.manager.transaction(
      // A no-match locking read must not gap-lock new Booking inserts while
      // this transaction waits for the Room row.
      'READ COMMITTED',
      async (manager) => {
        // Booking lifecycle also locks Booking before Room. Locking every
        // CONFIRMED/CHECKED_IN candidate closes the race where a check-in and
        // a manual Room transition start at the same time.
        const hasCheckedInBooking = await this.lockStayBookings(manager, id);
        const room = await this.lockRoomForStatusChange(manager, id);

        this.assertTransitionAllowed({
          currentStatus: room.status,
          nextStatus: status,
          role,
          hasCheckedInBooking,
        });

        if (room.status === status) {
          return room.id;
        }

        const updateResult = await manager.getRepository(Room).update(
          {
            id: room.id,
            status: room.status,
            deletedAt: IsNull(),
          },
          { status },
        );

        if (updateResult.affected !== 1) {
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

    return this.roomQuery.getAdminRoom(roomId);
  }

  private assertTransitionAllowed(context: RoomStatusTransitionContext): void {
    try {
      this.statusPolicy.assertAllowed(context);
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

  private async lockRoomForStatusChange(
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

  private async lockAdminRoom(
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

    if (roomType === null || roomType.deletedAt !== null) {
      throw new NotFoundException('Khong tim thay loai phong.');
    }

    return roomType;
  }

  private async lockActiveRoomForMutation(
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

  private async assertNumberAvailable(
    roomNumber: string,
    currentRoomId?: string,
    manager: EntityManager = this.roomRepo.manager,
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

  private async hasRoomHistory(
    roomId: string,
    manager: EntityManager = this.roomRepo.manager,
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

  private throwDuplicateConflict(error: unknown): never {
    if (getMysqlDuplicateKey(error) === undefined) {
      throw error;
    }

    throw new ConflictException(
      'So phong da ton tai, ke ca trong du lieu da xoa.',
    );
  }
}
