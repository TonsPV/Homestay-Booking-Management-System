import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import { getMysqlDuplicateKey } from '../../common/database';
import { requireTrimmedString } from '../../common/validation';
import {
  RoomCalendar,
  RoomCalendarStatus,
} from '../booking/schema/room-calendar.entity';
import { BlockRoomDatesDto } from './dto/block-room-dates.dto';
import { RoomCalendarRangeQueryDto } from './dto/room-calendar-range-query.dto';
import { Room } from './schema/room.entity';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const MAX_CALENDAR_RANGE_DAYS = 366;

export interface RoomCalendarEntryResponse {
  id: string;
  stayDate: string;
  status: RoomCalendarStatus;
  reason: string | null;
  booking: {
    id: string;
    bookingCode: string;
  } | null;
}

export interface UnblockRoomDatesResponse {
  removedCount: number;
}

@Injectable()
export class RoomAvailabilityService {
  constructor(private readonly dataSource: DataSource) {}

  async list(
    roomId: string,
    query: RoomCalendarRangeQueryDto,
  ): Promise<RoomCalendarEntryResponse[]> {
    this.validateRoomId(roomId);
    const range = this.requireDateRange(query.from, query.to);

    await this.requireRoom(this.dataSource.manager, roomId, false);

    const entries = await this.dataSource
      .getRepository(RoomCalendar)
      .createQueryBuilder('calendar')
      .leftJoinAndSelect('calendar.booking', 'booking')
      .where('calendar.roomId = :roomId', { roomId })
      .andWhere('calendar.stayDate >= :from', { from: range.from })
      .andWhere('calendar.stayDate < :to', { to: range.to })
      .orderBy('calendar.stayDate', 'ASC')
      .getMany();

    return entries.map((entry) => this.toResponse(entry));
  }

  async block(
    roomId: string,
    body: BlockRoomDatesDto,
  ): Promise<RoomCalendarEntryResponse[]> {
    this.validateRoomId(roomId);
    const range = this.requireDateRange(body.from, body.to);
    const reason = requireTrimmedString(
      body.reason,
      'Ly do khoa phong khong hop le.',
      500,
    );

    try {
      return await this.dataSource.transaction(async (manager) => {
        await this.requireRoom(manager, roomId, true);

        const repository = manager.getRepository(RoomCalendar);
        const entries = this.enumerateDates(range.from, range.to).map(
          (stayDate) =>
            repository.create({
              roomId,
              bookingId: null,
              stayDate,
              status: RoomCalendarStatus.BLOCKED,
              reason,
            }),
        );

        await repository.insert(entries);

        const savedEntries = await repository
          .createQueryBuilder('calendar')
          .where('calendar.roomId = :roomId', { roomId })
          .andWhere('calendar.stayDate >= :from', { from: range.from })
          .andWhere('calendar.stayDate < :to', { to: range.to })
          .andWhere('calendar.status = :status', {
            status: RoomCalendarStatus.BLOCKED,
          })
          .orderBy('calendar.stayDate', 'ASC')
          .getMany();

        return savedEntries.map((entry) => this.toResponse(entry));
      });
    } catch (error) {
      this.throwCalendarWriteConflict(error);
    }
  }

  async unblock(
    roomId: string,
    query: RoomCalendarRangeQueryDto,
  ): Promise<UnblockRoomDatesResponse> {
    this.validateRoomId(roomId);
    const range = this.requireDateRange(query.from, query.to);

    return this.dataSource.transaction(async (manager) => {
      await this.requireRoom(manager, roomId, true);

      const result = await manager
        .getRepository(RoomCalendar)
        .createQueryBuilder()
        .delete()
        .from(RoomCalendar)
        .where('room_id = :roomId', { roomId })
        .andWhere('stay_date >= :from', { from: range.from })
        .andWhere('stay_date < :to', { to: range.to })
        .andWhere('status = :status', {
          status: RoomCalendarStatus.BLOCKED,
        })
        .execute();

      return { removedCount: result.affected ?? 0 };
    });
  }

  private async requireRoom(
    manager: EntityManager,
    roomId: string,
    lock: boolean,
  ): Promise<void> {
    let query = manager
      .getRepository(Room)
      .createQueryBuilder('room')
      .where('room.id = :roomId', { roomId })
      .andWhere('room.deletedAt IS NULL');

    if (lock) {
      query = query.setLock('pessimistic_write');
    }

    if ((await query.getOne()) === null) {
      throw new NotFoundException('Khong tim thay phong.');
    }
  }

  private requireDateRange(
    fromValue: unknown,
    toValue: unknown,
  ): { from: string; to: string } {
    const from = this.requireIsoDate(fromValue, 'Ngay bat dau khong hop le.');
    const to = this.requireIsoDate(toValue, 'Ngay ket thuc khong hop le.');

    if (from >= to) {
      throw new BadRequestException('Ngay ket thuc phai sau ngay bat dau.');
    }

    const rangeDays =
      (Date.parse(`${to}T00:00:00.000Z`) -
        Date.parse(`${from}T00:00:00.000Z`)) /
      MILLISECONDS_PER_DAY;

    if (rangeDays > MAX_CALENDAR_RANGE_DAYS) {
      throw new BadRequestException(
        `Khoang ngay khong duoc vuot qua ${MAX_CALENDAR_RANGE_DAYS} ngay.`,
      );
    }

    return { from, to };
  }

  private requireIsoDate(value: unknown, message: string): string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      throw new BadRequestException(message);
    }

    const parsed = new Date(`${value}T00:00:00.000Z`);

    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== value
    ) {
      throw new BadRequestException(message);
    }

    return value;
  }

  private enumerateDates(from: string, to: string): string[] {
    const dates: string[] = [];
    const fromTimestamp = Date.parse(`${from}T00:00:00.000Z`);
    const toTimestamp = Date.parse(`${to}T00:00:00.000Z`);

    for (
      let timestamp = fromTimestamp;
      timestamp < toTimestamp;
      timestamp += MILLISECONDS_PER_DAY
    ) {
      dates.push(new Date(timestamp).toISOString().slice(0, 10));
    }

    return dates;
  }

  private validateRoomId(roomId: string): void {
    if (!/^[1-9][0-9]*$/.test(roomId)) {
      throw new BadRequestException('Room id khong hop le.');
    }
  }

  private throwCalendarWriteConflict(error: unknown): never {
    const duplicateKey = getMysqlDuplicateKey(error);

    if (
      duplicateKey !== undefined &&
      duplicateKey.includes('room_calendar_room_date')
    ) {
      throw new ConflictException(
        'Phong da duoc dat hoac bi khoa trong khoang ngay nay.',
      );
    }

    throw error;
  }

  private toResponse(entry: RoomCalendar): RoomCalendarEntryResponse {
    const booking = entry.booking;
    let bookingResponse: RoomCalendarEntryResponse['booking'] = null;

    if (entry.bookingId !== null) {
      if (booking === null) {
        throw new Error('Reserved room calendar entry is missing its booking.');
      }

      bookingResponse = {
        id: entry.bookingId,
        bookingCode: booking.bookingCode,
      };
    }

    return {
      id: entry.id,
      stayDate: entry.stayDate,
      status: entry.status,
      reason: entry.reason,
      booking: bookingResponse,
    };
  }
}
