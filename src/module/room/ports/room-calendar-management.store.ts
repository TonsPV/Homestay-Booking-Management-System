import type { TransactionContext } from '../../../common/application/transaction';
import type { RoomCalendar } from '../../booking/schema/room-calendar.entity';

export class RoomCalendarBlockConflictError extends Error {
  constructor() {
    super('The requested room dates conflict with existing calendar rows.');
    this.name = RoomCalendarBlockConflictError.name;
  }
}

export interface RoomCalendarDateRange {
  from: string;
  to: string;
}

export abstract class RoomCalendarManagementStore {
  abstract roomExists(roomId: string): Promise<boolean>;

  abstract lockRoom(
    context: TransactionContext,
    roomId: string,
  ): Promise<boolean>;

  abstract listRange(
    roomId: string,
    range: RoomCalendarDateRange,
  ): Promise<RoomCalendar[]>;

  abstract blockDates(
    context: TransactionContext,
    roomId: string,
    stayDates: string[],
    reason: string,
    range: RoomCalendarDateRange,
  ): Promise<RoomCalendar[]>;

  abstract unblockDates(
    context: TransactionContext,
    roomId: string,
    range: RoomCalendarDateRange,
  ): Promise<number>;
}
