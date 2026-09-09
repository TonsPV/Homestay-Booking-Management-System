import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';

import { TransactionRunner } from '../../common/application/transaction';
import { TransactionalAuditLog } from '../audit/ports/transactional-audit-log';
import type { AuditActorContext } from '../audit/audit-log.types';
import { AuditAction, AuditEntityType } from '../audit/domain/audit-log';
import { requireTrimmedString } from '../../common/validation';
import { RoomCalendar } from '../booking/schema/room-calendar.entity';
import { RoomCalendarStatus } from '../booking/domain/room-calendar-status';
import { BlockRoomDatesDto } from './dto/block-room-dates.dto';
import { RoomCalendarRangeQueryDto } from './dto/room-calendar-range-query.dto';
import {
  RoomCalendarBlockConflictError,
  RoomCalendarManagementStore,
} from './ports/room-calendar-management.store';

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
  constructor(
    private readonly transactions: TransactionRunner,
    private readonly roomCalendar: RoomCalendarManagementStore,
    private readonly auditLog: TransactionalAuditLog,
  ) {}

  async list(
    roomId: string,
    query: RoomCalendarRangeQueryDto,
  ): Promise<RoomCalendarEntryResponse[]> {
    this.validateRoomId(roomId);
    const range = this.requireDateRange(query.from, query.to);

    if (!(await this.roomCalendar.roomExists(roomId))) {
      throw new NotFoundException('Khong tim thay phong.');
    }

    const entries = await this.roomCalendar.listRange(roomId, range);

    return entries.map((entry) => this.toResponse(entry));
  }

  async block(
    roomId: string,
    body: BlockRoomDatesDto,
    actor: AuditActorContext,
  ): Promise<RoomCalendarEntryResponse[]> {
    this.validateRoomId(roomId);
    const range = this.requireDateRange(body.from, body.to);
    const reason = requireTrimmedString(
      body.reason,
      'Ly do khoa phong khong hop le.',
      500,
    );

    try {
      return await this.transactions.run(async (transaction) => {
        if (!(await this.roomCalendar.lockRoom(transaction, roomId))) {
          throw new NotFoundException('Khong tim thay phong.');
        }

        const savedEntries = await this.roomCalendar.blockDates(
          transaction,
          roomId,
          this.enumerateDates(range.from, range.to),
          reason,
          range,
        );

        await this.auditLog.record(transaction, {
          ...actor,
          action: AuditAction.ROOM_CALENDAR_BLOCKED,
          entityType: AuditEntityType.ROOM,
          entityId: roomId,
          metadata: {
            schemaVersion: 1,
            ...range,
            reason,
            addedCount: savedEntries.length,
          },
        });
        return savedEntries.map((entry) => this.toResponse(entry));
      });
    } catch (error) {
      this.throwCalendarWriteConflict(error);
    }
  }

  async unblock(
    roomId: string,
    query: RoomCalendarRangeQueryDto,
    actor: AuditActorContext,
  ): Promise<UnblockRoomDatesResponse> {
    this.validateRoomId(roomId);
    const range = this.requireDateRange(query.from, query.to);

    return this.transactions.run(async (transaction) => {
      if (!(await this.roomCalendar.lockRoom(transaction, roomId))) {
        throw new NotFoundException('Khong tim thay phong.');
      }

      const removedCount = await this.roomCalendar.unblockDates(
        transaction,
        roomId,
        range,
      );
      if (removedCount > 0) {
        await this.auditLog.record(transaction, {
          ...actor,
          action: AuditAction.ROOM_CALENDAR_UNBLOCKED,
          entityType: AuditEntityType.ROOM,
          entityId: roomId,
          metadata: { schemaVersion: 1, ...range, removedCount },
        });
      }
      return { removedCount };
    });
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
    if (error instanceof RoomCalendarBlockConflictError) {
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
