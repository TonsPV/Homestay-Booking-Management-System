import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { TransactionContext } from '../../../../common/application/transaction';
import { getMysqlDuplicateKey } from '../../../../common/database';
import { TypeOrmTransactionRunner } from '../../../../common/infrastructure/persistence/typeorm-transaction.runner';
import { Booking } from '../../../booking/schema/booking.entity';
import { PaymentStatus } from '../../domain/payment-state';
import {
  PaymentRefundIdempotencyConflictError,
  PaymentRefundStore,
  type CreatePaymentRefundRecord,
} from '../../ports/payment-refund.store';
import { Payment } from '../../schema/payment.entity';
import { PaymentRefund } from '../../schema/payment-refund.entity';

@Injectable()
export class TypeOrmPaymentRefundStore extends PaymentRefundStore {
  constructor(
    private readonly dataSource: DataSource,
    private readonly transactions: TypeOrmTransactionRunner,
  ) {
    super();
  }

  findPaymentSnapshot(paymentId: string): Promise<Payment | null> {
    return this.dataSource.getRepository(Payment).findOne({
      where: { id: paymentId },
      relations: { refund: true },
    });
  }

  findPayment(
    context: TransactionContext,
    paymentId: string,
  ): Promise<Payment | null> {
    return this.transactions
      .managerFor(context)
      .getRepository(Payment)
      .findOne({
        where: { id: paymentId },
        relations: { refund: true },
      });
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

  lockPayment(
    context: TransactionContext,
    paymentId: string,
  ): Promise<Payment | null> {
    return this.transactions
      .managerFor(context)
      .getRepository(Payment)
      .createQueryBuilder('payment')
      .leftJoinAndSelect('payment.refund', 'refund')
      .setLock('pessimistic_write')
      .where('payment.id = :paymentId', { paymentId })
      .getOne();
  }

  findByRefundIdempotencyKey(
    context: TransactionContext,
    key: string,
  ): Promise<PaymentRefund | null> {
    return this.transactions
      .managerFor(context)
      .getRepository(PaymentRefund)
      .findOneBy({ idempotencyKey: key });
  }

  async createRefund(
    context: TransactionContext,
    input: CreatePaymentRefundRecord,
  ): Promise<PaymentRefund> {
    const repository = this.transactions
      .managerFor(context)
      .getRepository(PaymentRefund);

    try {
      return await repository.save(repository.create(input));
    } catch (error) {
      const duplicateKey = getMysqlDuplicateKey(error);

      if (duplicateKey?.includes('payment_refunds_idempotency')) {
        throw new PaymentRefundIdempotencyConflictError();
      }

      throw error;
    }
  }

  lockCanonicalSuccessfulPayment(
    context: TransactionContext,
    canonicalPaymentId: string,
    bookingId: string,
  ): Promise<Payment | null> {
    return this.transactions
      .managerFor(context)
      .getRepository(Payment)
      .createQueryBuilder('canonicalPayment')
      .setLock('pessimistic_write')
      .where('canonicalPayment.id = :canonicalPaymentId', {
        canonicalPaymentId,
      })
      .andWhere('canonicalPayment.bookingId = :bookingId', { bookingId })
      .andWhere('canonicalPayment.status = :status', {
        status: PaymentStatus.SUCCESS,
      })
      .getOne();
  }

  async savePaymentState(
    context: TransactionContext,
    payment: Payment,
  ): Promise<void> {
    await this.transactions
      .managerFor(context)
      .getRepository(Payment)
      .save(payment);
  }

  async saveRefundState(
    context: TransactionContext,
    refund: PaymentRefund,
  ): Promise<void> {
    await this.transactions
      .managerFor(context)
      .getRepository(PaymentRefund)
      .save(refund);
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

  async recordRefundQueryFailure(paymentId: string, now: Date): Promise<void> {
    const payment = await this.dataSource.getRepository(Payment).findOne({
      where: { id: paymentId, status: PaymentStatus.REFUND_PENDING },
      relations: { refund: true },
    });

    if (payment?.refund === null || payment?.refund === undefined) {
      return;
    }

    payment.refund.lastQueriedAt = now;
    payment.refund.message = 'Khong the ket noi VNPay de doi soat.';
    await this.dataSource.getRepository(PaymentRefund).save(payment.refund);
  }
}
