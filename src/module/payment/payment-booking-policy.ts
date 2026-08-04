import { ConflictException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import {
  Booking,
  BookingPaymentStatus,
  BookingStatus,
} from '../booking/schema/booking.entity';
import { Payment, PaymentMethod, PaymentStatus } from './schema/payment.entity';

export async function getLockedPaymentBooking(
  manager: EntityManager,
  id: string,
): Promise<Booking> {
  const booking = await manager
    .getRepository(Booking)
    .createQueryBuilder('booking')
    .setLock('pessimistic_write')
    .where('booking.id = :id', { id })
    .getOne();

  if (booking === null) {
    throw new NotFoundException('Khong tim thay booking.');
  }

  return booking;
}

export function assertBookingCanAcceptPayment(
  booking: Booking,
  paymentTimeoutMilliseconds: number,
): void {
  if (booking.paymentStatus === BookingPaymentStatus.PAID) {
    throw new ConflictException('Booking da duoc thanh toan.');
  }

  if (booking.paymentStatus === BookingPaymentStatus.REFUNDED) {
    throw new ConflictException('Booking da duoc hoan tien.');
  }

  if (
    booking.status !== BookingStatus.PENDING_PAYMENT &&
    booking.status !== BookingStatus.CONFIRMED
  ) {
    throw new ConflictException(
      'Khong the thanh toan booking o trang thai hien tai.',
    );
  }

  const paymentExpiresAt =
    booking.paymentExpiresAt ??
    new Date(booking.createdAt.getTime() + paymentTimeoutMilliseconds);

  if (
    booking.status === BookingStatus.PENDING_PAYMENT &&
    paymentExpiresAt.getTime() <= Date.now()
  ) {
    throw new ConflictException('Booking da het thoi gian thanh toan.');
  }
}

export async function failExpiredOnlinePaymentsForBooking(
  manager: EntityManager,
  bookingId: string,
  now: Date,
): Promise<void> {
  await manager
    .getRepository(Payment)
    .createQueryBuilder()
    .update(Payment)
    .set({
      status: PaymentStatus.FAILED,
      gatewayResponseCode: 'EXPIRED',
    })
    .where('booking_id = :bookingId', { bookingId })
    .andWhere('method = :method', { method: PaymentMethod.VNPAY })
    .andWhere('status = :status', { status: PaymentStatus.PENDING })
    .andWhere('expires_at IS NOT NULL')
    .andWhere('expires_at <= :now', { now })
    .execute();
}
