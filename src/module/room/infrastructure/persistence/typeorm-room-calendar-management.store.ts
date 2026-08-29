import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { TransactionContext } from '../../../../common/application/transaction';
import { getMysqlDuplicateKey } from '../../../../common/database';
import { TypeOrmTransactionRunner } from '../../../../common/infrastructure/persistence/typeorm-transaction.runner';
import { RoomCalendarStatus } from '../../../booking/domain/room-calendar-status';
import { RoomCalendar } from '../../../booking/schema/room-calendar.entity';
import {
  RoomCalendarManagementStore,
  RoomCalendarBlockConflictError,
  type RoomCalendarDateRange,
} from '../../ports/room-calendar-management.store';
import { Room } from '../../schema/room.entity';

@Injectable()
export class TypeOrmRoomCalendarManagementStore extends RoomCalendarManagementStore {
  constructor(
    private readonly dataSource: DataSource,
    private readonly transactions: TypeOrmTransactionRunner,
  ) {
    super();
  }

  async roomExists(roomId: string): Promise<boolean> {
    return (
      (await this.dataSource
        .getRepository(Room)
        .createQueryBuilder('room')
        .where('room.id = :roomId', { roomId })
        .andWhere('room.deletedAt IS NULL')
        .getOne()) !== null
    );
  }

  async lockRoom(
    context: TransactionContext,
    roomId: string,
  ): Promise<boolean> {
    return (
      (await this.transactions
        .managerFor(context)
        .getRepository(Room)
        .createQueryBuilder('room')
        .where('room.id = :roomId', { roomId })
        .andWhere('room.deletedAt IS NULL')
        .setLock('pessimistic_write')
        .getOne()) !== null
    );
  }

  listRange(
    roomId: string,
    range: RoomCalendarDateRange,
  ): Promise<RoomCalendar[]> {
    return this.dataSource
      .getRepository(RoomCalendar)
      .createQueryBuilder('calendar')
      .leftJoinAndSelect('calendar.booking', 'booking')
      .where('calendar.roomId = :roomId', { roomId })
      .andWhere('calendar.stayDate >= :from', { from: range.from })
      .andWhere('calendar.stayDate < :to', { to: range.to })
      .orderBy('calendar.stayDate', 'ASC')
      .getMany();
  }

  async blockDates(
    context: TransactionContext,
    roomId: string,
    stayDates: string[],
    reason: string,
    range: RoomCalendarDateRange,
  ): Promise<RoomCalendar[]> {
    const repository = this.transactions
      .managerFor(context)
      .getRepository(RoomCalendar);
    const entries = stayDates.map((stayDate) =>
      repository.create({
        roomId,
        bookingId: null,
        stayDate,
        status: RoomCalendarStatus.BLOCKED,
        reason,
      }),
    );

    try {
      await repository.insert(entries);
    } catch (error) {
      const duplicateKey = getMysqlDuplicateKey(error);

      if (duplicateKey?.includes('room_calendar_room_date')) {
        throw new RoomCalendarBlockConflictError();
      }

      throw error;
    }

    return repository
      .createQueryBuilder('calendar')
      .where('calendar.roomId = :roomId', { roomId })
      .andWhere('calendar.stayDate >= :from', { from: range.from })
      .andWhere('calendar.stayDate < :to', { to: range.to })
      .andWhere('calendar.status = :status', {
        status: RoomCalendarStatus.BLOCKED,
      })
      .orderBy('calendar.stayDate', 'ASC')
      .getMany();
  }

  async unblockDates(
    context: TransactionContext,
    roomId: string,
    range: RoomCalendarDateRange,
  ): Promise<number> {
    const result = await this.transactions
      .managerFor(context)
      .getRepository(RoomCalendar)
      .createQueryBuilder()
      .delete()
      .from(RoomCalendar)
      .where('room_id = :roomId', { roomId })
      .andWhere('stay_date >= :from', { from: range.from })
      .andWhere('stay_date < :to', { to: range.to })
      .andWhere('status = :status', { status: RoomCalendarStatus.BLOCKED })
      .execute();

    return result.affected ?? 0;
  }
}
