import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  type TransactionContext,
  TransactionRunner,
} from '../../common/database/transaction';
import {
  isValidIdempotencyKey,
  requireTrimmedString,
} from '../../common/validation';
import { BookingPaymentLifecycleService } from '../booking/booking-payment-lifecycle.service';
import { CreateManualPaymentDto } from './dto/create-manual-payment.dto';
import { assertBookingCanAcceptPayment } from './payment-booking.application';
import {
  PaymentAcceptanceStore,
  PaymentIdempotencyConflictError,
} from './ports/payment-acceptance.store';
import { PaymentQueryService } from './payment-query.service';
import type { PaymentResponse } from './payment.types';
import { Payment } from './schema/payment.entity';
import { PaymentMethod, PaymentStatus } from './domain/payment-state';

/**
 * Manual (cash / bank transfer) payment command entry point. Owns
 * validation, idempotency and payment row creation; the cross-aggregate
 * booking side effects of an accepted payment are delegated to
 * BookingPaymentLifecycleService.
 */
@Injectable()
export class PaymentManualService {
  private readonly paymentTimeoutMs: number;

  constructor(
    private readonly transactions: TransactionRunner,
    private readonly payments: PaymentAcceptanceStore,
    private readonly lifecycle: BookingPaymentLifecycleService,
    private readonly paymentQuery: PaymentQueryService,
    configService: ConfigService,
  ) {
    this.paymentTimeoutMs =
      configService.getOrThrow<number>('BOOKING_PAYMENT_TIMEOUT_MINUTES') *
      60 *
      1000;
  }

  async record(
    userId: string | undefined,
    bookingId: string,
    idempotencyKey: string | undefined,
    body: CreateManualPaymentDto,
    requestId?: string,
  ): Promise<PaymentResponse> {
    const createdByUserId = this.requireActorId(userId);
    this.validateId(bookingId, 'Booking id khong hop le.');
    const key = this.requireIdempotencyKey(idempotencyKey);
    const method = this.requireManualMethod(body.method);
    let paymentId: string;

    try {
      paymentId = await this.transactions.run(async (transaction) => {
        const booking = await this.lockBooking(transaction, bookingId);
        const existingPayment = await this.payments.findByIdempotencyKey(
          transaction,
          key,
        );

        if (existingPayment !== null) {
          this.assertIdempotentReplay(
            existingPayment,
            bookingId,
            createdByUserId,
            method,
          );
          return existingPayment.id;
        }

        await this.payments.expirePendingOnlineAttempts(
          transaction,
          booking.id,
          new Date(),
        );

        if (
          await this.payments.hasPendingOnlineAttempt(transaction, booking.id)
        ) {
          throw new ConflictException(
            'Booking dang co giao dich VNPay cho xu ly.',
          );
        }

        assertBookingCanAcceptPayment(booking, this.paymentTimeoutMs);

        const bookingFromStatus = booking.status;
        const now = new Date();
        const payment = await this.payments.createPayment(transaction, {
          bookingId: booking.id,
          amount: booking.totalAmount,
          currency: 'VND',
          method,
          status: PaymentStatus.SUCCESS,
          gatewayName: null,
          gatewayReference: null,
          gatewayTransactionId: null,
          gatewayPaymentUrl: null,
          gatewayResponseCode: null,
          gatewayTransactionStatus: null,
          idempotencyKey: key,
          createdByUserId,
          paidAt: now,
          expiresAt: null,
        });

        await this.lifecycle.applyAcceptedManualPayment(transaction, {
          booking,
          payment,
          bookingFromStatus,
          requestId,
        });

        return payment.id;
      });
    } catch (error) {
      paymentId = await this.resolveIdempotencyConflict(
        error,
        key,
        bookingId,
        createdByUserId,
        method,
      );
    }

    return this.paymentQuery.getManagementPayment(paymentId);
  }

  private assertIdempotentReplay(
    payment: Payment,
    bookingId: string,
    userId: string,
    method: PaymentMethod,
  ): void {
    if (
      payment.bookingId !== bookingId ||
      payment.createdByUserId !== userId ||
      payment.method !== method
    ) {
      throw new ConflictException(
        'Idempotency-Key da duoc su dung cho request khac.',
      );
    }
  }

  private async resolveIdempotencyConflict(
    error: unknown,
    key: string,
    bookingId: string,
    userId: string,
    method: PaymentMethod,
  ): Promise<string> {
    if (!(error instanceof PaymentIdempotencyConflictError)) {
      throw error;
    }

    const payment = await this.payments.findByIdempotencyKeySnapshot(key);

    if (payment === null) {
      throw new ConflictException('Khong the ghi nhan payment trung lap.');
    }

    this.assertIdempotentReplay(payment, bookingId, userId, method);
    return payment.id;
  }

  private async lockBooking(context: TransactionContext, bookingId: string) {
    const booking = await this.payments.lockBooking(context, bookingId);

    if (booking === null) {
      throw new NotFoundException('Khong tim thay booking.');
    }

    return booking;
  }

  private requireManualMethod(value: unknown): PaymentMethod {
    const method = this.optionalMethod(value);

    if (
      method === undefined ||
      (method !== PaymentMethod.CASH && method !== PaymentMethod.BANK_TRANSFER)
    ) {
      throw new BadRequestException('Phuong thuc thanh toan khong hop le.');
    }

    return method;
  }

  private optionalMethod(value: unknown): PaymentMethod | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    if (
      typeof value !== 'string' ||
      !Object.values(PaymentMethod).includes(value as PaymentMethod)
    ) {
      throw new BadRequestException('Phuong thuc thanh toan khong hop le.');
    }

    return value as PaymentMethod;
  }

  private requireIdempotencyKey(value: string | undefined): string {
    const key = requireTrimmedString(
      value,
      'Idempotency-Key la bat buoc.',
      100,
    );

    if (!isValidIdempotencyKey(key)) {
      throw new BadRequestException('Idempotency-Key khong hop le.');
    }

    return key;
  }

  private requireActorId(value: string | undefined): string {
    if (value === undefined || !/^[1-9][0-9]*$/.test(value)) {
      throw new UnauthorizedException('Access token is invalid.');
    }

    return value;
  }

  private validateId(value: string, message: string): void {
    if (!/^[1-9][0-9]*$/.test(value)) {
      throw new BadRequestException(message);
    }
  }
}
