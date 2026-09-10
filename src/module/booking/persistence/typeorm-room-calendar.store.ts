import { Injectable } from '@nestjs/common';
import { In } from 'typeorm';

import type { TransactionContext } from '../../../common/database/transaction';
import { getMysqlDuplicateKey } from '../../../common/database';
import { TypeOrmTransactionRunner } from '../../../common/database/typeorm-transaction.runner';
import { RoomCalendarStatus } from '../domain/room-calendar-status';
import {
  RoomCalendarReservationConflictError,
  RoomCalendarStore,
} from '../ports/room-calendar.store';
import { RoomCalendar } from '../schema/room-calendar.entity';

@Injectable()
export class TypeOrmRoomCalendarStore extends RoomCalendarStore {
  constructor(private readonly transactions: TypeOrmTransactionRunner) {
    super();
  }

  async reserveBookingStay(
    context: TransactionContext,
    roomId: string,
    bookingId: string,
    stayDates: string[],
  ): Promise<void> {
    const repository = this.transactions
      .managerFor(context)
      .getRepository(RoomCalendar);
    const entries = stayDates.map((stayDate) =>
      repository.create({
        roomId,
        bookingId,
        stayDate,
        status: RoomCalendarStatus.RESERVED,
        reason: null,
      }),
    );

    try {
      await repository.insert(entries);
    } catch (error) {
      const duplicateKey = getMysqlDuplicateKey(error);

      if (duplicateKey?.includes('room_calendar_room_date')) {
        throw new RoomCalendarReservationConflictError();
      }

      throw error;
    }
  }

  async releaseBookingReservations(
    context: TransactionContext,
    bookingIds: string[],
  ): Promise<void> {
    if (bookingIds.length === 0) {
      return;
    }

    await this.transactions
      .managerFor(context)
      .getRepository(RoomCalendar)
      .delete({ bookingId: In(bookingIds) });
  }

  async releaseBookingReservation(
    context: TransactionContext,
    bookingId: string,
  ): Promise<void> {
    await this.transactions
      .managerFor(context)
      .getRepository(RoomCalendar)
      .delete({ bookingId });
  }
}
