import type { TransactionContext } from '../../../common/application/transaction';
import type { Room } from '../../room/schema/room.entity';
import type { Booking } from '../schema/booking.entity';

export abstract class BookingLifecycleStore {
  abstract findForUpdate(
    context: TransactionContext,
    bookingId: string,
  ): Promise<Booking | null>;

  abstract findExpiredForUpdate(
    context: TransactionContext,
    now: Date,
    legacyCutoff: Date,
    limit: number,
  ): Promise<Booking[]>;

  abstract saveState(
    context: TransactionContext,
    booking: Booking | Booking[],
  ): Promise<void>;

  abstract findStayRoomForUpdate(
    context: TransactionContext,
    roomId: string,
  ): Promise<Room | null>;

  abstract saveRoomState(
    context: TransactionContext,
    room: Room,
  ): Promise<void>;
}

export abstract class BookingPaymentStateStore {
  abstract hasPendingRefund(
    context: TransactionContext,
    bookingId: string,
  ): Promise<boolean>;

  abstract failPendingOnlinePayments(
    context: TransactionContext,
    bookingIds: string[],
    responseCode: 'CANCELLED' | 'EXPIRED',
  ): Promise<void>;
}
