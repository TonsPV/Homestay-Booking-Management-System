import type { TransactionContext } from '../../../common/database/transaction';

export class RoomCalendarReservationConflictError extends Error {
  constructor() {
    super('The requested room stay conflicts with an existing calendar row.');
    this.name = RoomCalendarReservationConflictError.name;
  }
}

export abstract class RoomCalendarStore {
  abstract reserveBookingStay(
    context: TransactionContext,
    roomId: string,
    bookingId: string,
    stayDates: string[],
  ): Promise<void>;

  abstract releaseBookingReservations(
    context: TransactionContext,
    bookingIds: string[],
  ): Promise<void>;

  abstract releaseBookingReservation(
    context: TransactionContext,
    bookingId: string,
  ): Promise<void>;
}
