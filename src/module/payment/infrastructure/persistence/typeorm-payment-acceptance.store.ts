import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { TransactionContext } from '../../../../common/application/transaction';
import { getMysqlDuplicateKey } from '../../../../common/database';
import { TypeOrmTransactionRunner } from '../../../../common/infrastructure/persistence/typeorm-transaction.runner';
import { Booking } from '../../../booking/schema/booking.entity';
import {
  PaymentAcceptanceStore,
  PaymentIdempotencyConflictError,
  type CreatePaymentInput,
} from '../../ports/payment-acceptance.store';
import { Payment } from '../../schema/payment.entity';
import { PaymentMethod, PaymentStatus } from '../../domain/payment-state';

@Injectable()
export class TypeOrmPaymentAcceptanceStore extends PaymentAcceptanceStore {
  constructor(
    private readonly dataSource: DataSource,
    private readonly transactions: TypeOrmTransactionRunner,
  ) {
    super();
  }

  findPaymentSnapshot(paymentId: string): Promise<Payment | null> {
    return this.dataSource.getRepository(Payment).findOneBy({ id: paymentId });
  }

  lockBooking(
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

  findByIdempotencyKey(
    context: TransactionContext,
    key: string,
  ): Promise<Payment | null> {
    return this.transactions
      .managerFor(context)
      .getRepository(Payment)
      .findOneBy({ idempotencyKey: key });
  }

  findByIdempotencyKeySnapshot(key: string): Promise<Payment | null> {
    return this.dataSource
      .getRepository(Payment)
      .findOneBy({ idempotencyKey: key });
  }

  findByGatewayReferenceSnapshot(
    gatewayReference: string,
  ): Promise<Payment | null> {
    return this.dataSource
      .getRepository(Payment)
      .findOneBy({ gatewayReference });
  }

  async expirePendingOnlineAttempts(
    context: TransactionContext,
    bookingId: string,
    now: Date,
  ): Promise<void> {
    await this.transactions
      .managerFor(context)
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

  hasPendingOnlineAttempt(
    context: TransactionContext,
    bookingId: string,
  ): Promise<boolean> {
    return this.transactions
      .managerFor(context)
      .getRepository(Payment)
      .exists({
        where: {
          bookingId,
          method: PaymentMethod.VNPAY,
          status: PaymentStatus.PENDING,
        },
      });
  }

  async createPayment(
    context: TransactionContext,
    input: CreatePaymentInput,
  ): Promise<Payment> {
    const repository = this.transactions
      .managerFor(context)
      .getRepository(Payment);

    try {
      return await repository.save(repository.create(input));
    } catch (error) {
      const duplicateKey = getMysqlDuplicateKey(error);

      if (duplicateKey?.includes('payments_idempotency')) {
        throw new PaymentIdempotencyConflictError();
      }

      throw error;
    }
  }

  async savePaymentState(
    context: TransactionContext,
    payment: Payment | Payment[],
  ): Promise<void> {
    const repository = this.transactions
      .managerFor(context)
      .getRepository(Payment);

    if (Array.isArray(payment)) {
      await repository.save(payment);
      return;
    }

    await repository.save(payment);
  }

  async saveBookingState(
    context: TransactionContext,
    booking: Booking,
  ): Promise<void> {
    await this.transactions
      .managerFor(context)
      .getRepository(Booking)
      .save(booking);
  }

  lockPayment(
    context: TransactionContext,
    paymentId: string,
  ): Promise<Payment | null> {
    return this.transactions
      .managerFor(context)
      .getRepository(Payment)
      .createQueryBuilder('payment')
      .setLock('pessimistic_write')
      .where('payment.id = :paymentId', { paymentId })
      .getOne();
  }

  lockCanonicalPayment(
    context: TransactionContext,
    bookingId: string,
    excludedPaymentId: string,
  ): Promise<Payment | null> {
    return this.transactions
      .managerFor(context)
      .getRepository(Payment)
      .createQueryBuilder('canonicalPayment')
      .setLock('pessimistic_write')
      .where('canonicalPayment.bookingId = :bookingId', { bookingId })
      .andWhere('canonicalPayment.id <> :paymentId', {
        paymentId: excludedPaymentId,
      })
      .andWhere('canonicalPayment.status IN (:...statuses)', {
        statuses: [
          PaymentStatus.SUCCESS,
          PaymentStatus.REFUND_PENDING,
          PaymentStatus.REFUNDED,
        ],
      })
      .orderBy('canonicalPayment.id', 'ASC')
      .getOne();
  }

  lockExpiredOnlinePayments(
    context: TransactionContext,
    now: Date,
    limit: number,
  ): Promise<Payment[]> {
    return this.transactions
      .managerFor(context)
      .getRepository(Payment)
      .createQueryBuilder('payment')
      .setLock('pessimistic_write')
      .where('payment.method = :method', { method: PaymentMethod.VNPAY })
      .andWhere('payment.status = :status', { status: PaymentStatus.PENDING })
      .andWhere('payment.expiresAt IS NOT NULL')
      .andWhere('payment.expiresAt <= :now', { now })
      .orderBy('payment.id', 'ASC')
      .take(limit)
      .getMany();
  }
}
