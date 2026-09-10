import { Injectable } from '@nestjs/common';

import type { TransactionContext } from '../../../common/database/transaction';
import { TypeOrmTransactionRunner } from '../../../common/database/typeorm-transaction.runner';
import { Payment } from '../../payment/schema/payment.entity';
import {
  PaymentMethod,
  PaymentStatus,
} from '../../payment/domain/payment-state';
import { Room } from '../../room/schema/room.entity';
import {
  BookingLifecycleStore,
  BookingPaymentStateStore,
} from '../ports/booking-lifecycle.store';
import { Booking } from '../schema/booking.entity';
import { BookingPaymentStatus, BookingStatus } from '../domain/booking-state';

@Injectable()
export class TypeOrmBookingLifecycleStore extends BookingLifecycleStore {
  constructor(private readonly transactions: TypeOrmTransactionRunner) {
    super();
  }

  findForUpdate(
    context: TransactionContext,
    bookingId: string,
  ): Promise<Booking | null> {
    return this.transactions
      .managerFor(context)
      .getRepository(Booking)
      .createQueryBuilder('booking')
      .setLock('pessimistic_write')
      .where('booking.id = :id', { id: bookingId })
      .getOne();
  }

  findExpiredForUpdate(
    context: TransactionContext,
    now: Date,
    legacyCutoff: Date,
    limit: number,
  ): Promise<Booking[]> {
    return this.transactions
      .managerFor(context)
      .getRepository(Booking)
      .createQueryBuilder('booking')
      .setLock('pessimistic_write')
      .where('booking.status = :status', {
        status: BookingStatus.PENDING_PAYMENT,
      })
      .andWhere('booking.paymentStatus = :paymentStatus', {
        paymentStatus: BookingPaymentStatus.UNPAID,
      })
      .andWhere(
        `(
          booking.paymentExpiresAt <= :now
          OR (
            booking.paymentExpiresAt IS NULL
            AND booking.createdAt <= :legacyCutoff
          )
        )`,
        { now, legacyCutoff },
      )
      .orderBy('booking.id', 'ASC')
      .take(limit)
      .getMany();
  }

  async saveState(
    context: TransactionContext,
    booking: Booking | Booking[],
  ): Promise<void> {
    const repository = this.transactions
      .managerFor(context)
      .getRepository(Booking);

    if (Array.isArray(booking)) {
      await repository.save(booking);
      return;
    }

    await repository.save(booking);
  }

  findStayRoomForUpdate(
    context: TransactionContext,
    roomId: string,
  ): Promise<Room | null> {
    return this.transactions
      .managerFor(context)
      .getRepository(Room)
      .createQueryBuilder('room')
      .setLock('pessimistic_write')
      .where('room.id = :roomId', { roomId })
      .andWhere('room.deletedAt IS NULL')
      .getOne();
  }

  async saveRoomState(context: TransactionContext, room: Room): Promise<void> {
    await this.transactions.managerFor(context).getRepository(Room).save(room);
  }
}

@Injectable()
export class TypeOrmBookingPaymentStateStore extends BookingPaymentStateStore {
  constructor(private readonly transactions: TypeOrmTransactionRunner) {
    super();
  }

  hasPendingRefund(
    context: TransactionContext,
    bookingId: string,
  ): Promise<boolean> {
    return this.transactions
      .managerFor(context)
      .getRepository(Payment)
      .existsBy({
        bookingId,
        status: PaymentStatus.REFUND_PENDING,
      });
  }

  async failPendingOnlinePayments(
    context: TransactionContext,
    bookingIds: string[],
    responseCode: 'CANCELLED' | 'EXPIRED',
  ): Promise<void> {
    if (bookingIds.length === 0) {
      return;
    }

    await this.transactions
      .managerFor(context)
      .getRepository(Payment)
      .createQueryBuilder()
      .update(Payment)
      .set({
        status: PaymentStatus.FAILED,
        gatewayResponseCode: responseCode,
      })
      .where('booking_id IN (:...bookingIds)', { bookingIds })
      .andWhere('method = :method', { method: PaymentMethod.VNPAY })
      .andWhere('status = :status', { status: PaymentStatus.PENDING })
      .execute();
  }
}
