import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type Repository } from 'typeorm';

import { getMysqlDuplicateKey } from '../../common/database';
import { requireTrimmedString } from '../../common/validation';
import {
  Booking,
  BookingPaymentStatus,
  BookingStatus,
} from '../booking/schema/booking.entity';
import { CreateManualPaymentDto } from './dto/create-manual-payment.dto';
import {
  assertBookingCanAcceptPayment,
  failExpiredOnlinePaymentsForBooking,
  getLockedPaymentBooking,
} from './payment-booking-policy';
import { PaymentQueryService } from './payment-query.service';
import type { PaymentResponse } from './payment.types';
import { Payment, PaymentMethod, PaymentStatus } from './schema/payment.entity';

@Injectable()
export class PaymentManualService {
  private readonly paymentTimeoutMilliseconds: number;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Payment)
    private readonly paymentsRepository: Repository<Payment>,
    private readonly paymentQueryService: PaymentQueryService,
    configService: ConfigService,
  ) {
    this.paymentTimeoutMilliseconds =
      configService.getOrThrow<number>('BOOKING_PAYMENT_TIMEOUT_MINUTES') *
      60 *
      1000;
  }

  async record(
    userId: string | undefined,
    bookingId: string,
    idempotencyKey: string | undefined,
    body: CreateManualPaymentDto,
  ): Promise<PaymentResponse> {
    const createdByUserId = this.requireActorId(userId);
    this.validateId(bookingId, 'Booking id khong hop le.');
    const key = this.requireIdempotencyKey(idempotencyKey);
    const method = this.requireManualMethod(body.method);
    let paymentId: string;

    try {
      paymentId = await this.dataSource.transaction(async (manager) => {
        const booking = await getLockedPaymentBooking(manager, bookingId);
        const paymentsRepository = manager.getRepository(Payment);
        const existingPayment = await paymentsRepository.findOneBy({
          idempotencyKey: key,
        });

        if (existingPayment !== null) {
          this.assertIdempotentReplay(
            existingPayment,
            bookingId,
            createdByUserId,
            method,
          );
          return existingPayment.id;
        }

        await failExpiredOnlinePaymentsForBooking(
          manager,
          booking.id,
          new Date(),
        );

        if (
          await paymentsRepository.exists({
            where: {
              bookingId: booking.id,
              method: PaymentMethod.VNPAY,
              status: PaymentStatus.PENDING,
            },
          })
        ) {
          throw new ConflictException(
            'Booking dang co giao dich VNPay cho xu ly.',
          );
        }

        assertBookingCanAcceptPayment(booking, this.paymentTimeoutMilliseconds);

        const now = new Date();
        const payment = await paymentsRepository.save(
          paymentsRepository.create({
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
            refundedByUserId: null,
            paidAt: now,
            refundedAt: null,
            expiresAt: null,
          }),
        );

        booking.paymentStatus = BookingPaymentStatus.PAID;
        booking.paymentExpiresAt = null;

        if (booking.status === BookingStatus.PENDING_PAYMENT) {
          booking.status = BookingStatus.CONFIRMED;
        }

        await manager.getRepository(Booking).save(booking);

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

    return this.paymentQueryService.getManagementPayment(paymentId);
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
    const duplicateKey = getMysqlDuplicateKey(error);

    if (
      duplicateKey === undefined ||
      !duplicateKey.includes('payments_idempotency')
    ) {
      throw error;
    }

    const payment = await this.paymentsRepository.findOneBy({
      idempotencyKey: key,
    });

    if (payment === null) {
      throw new ConflictException('Khong the ghi nhan payment trung lap.');
    }

    this.assertIdempotentReplay(payment, bookingId, userId, method);
    return payment.id;
  }

  private requireManualMethod(value: unknown): PaymentMethod {
    const method = this.optionalPaymentMethod(value);

    if (
      method === undefined ||
      (method !== PaymentMethod.CASH && method !== PaymentMethod.BANK_TRANSFER)
    ) {
      throw new BadRequestException('Phuong thuc thanh toan khong hop le.');
    }

    return method;
  }

  private optionalPaymentMethod(value: unknown): PaymentMethod | undefined {
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

    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,99}$/.test(key)) {
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
