import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  type TransactionContext,
  TransactionRunner,
} from '../../common/application/transaction';
import {
  isValidIdempotencyKey,
  requireTrimmedString,
} from '../../common/validation';
import { TransactionalAuditLog } from '../audit/ports/transactional-audit-log';
import { BookingStatus } from '../booking/domain/booking-state';
import { BookingPaymentLifecycleService } from '../booking/booking-payment-lifecycle.service';
import { CreateVnpayPaymentDto } from './dto/create-vnpay-payment.dto';
import { assertBookingCanAcceptPayment } from './payment-booking.application';
import {
  PaymentAcceptanceStore,
  PaymentIdempotencyConflictError,
} from './ports/payment-acceptance.store';
import { PaymentQueryService } from './payment-query.service';
import type {
  OnlinePaymentResponse,
  VnPayIpnResponse,
  VnPayReturnResponse,
} from './payment.types';
import { Payment } from './schema/payment.entity';
import {
  PaymentMethod,
  PaymentReviewReason,
  PaymentStatus,
} from './domain/payment-state';
import {
  toVnPayAmount,
  VnPayGatewayService,
  type VnPayBankCode,
  type VnPayLocale,
} from './vnpay-gateway.service';

type VnPayCallbackValidation =
  | {
      kind: 'VALID';
      gatewayReference: string;
      vnpAmount: string;
      responseCode: string;
      transactionStatus: string;
      transactionId: string;
      paidAt: Date | null;
    }
  | {
      kind: 'INVALID_SIGNATURE' | 'INVALID_INPUT' | 'ERROR';
    };

type ValidVnPayCallback = Extract<VnPayCallbackValidation, { kind: 'VALID' }>;

type VnPayCallbackOutcome =
  | 'PROCESSED'
  | 'NOT_FOUND'
  | 'INVALID_AMOUNT'
  | 'ALREADY_PROCESSED'
  | 'REQUIRES_REVIEW'
  | 'ERROR';

interface VnPayCallbackProcessResult {
  outcome: VnPayCallbackOutcome;
  paymentId: string | null;
  bookingId: string | null;
}

@Injectable()
export class PaymentCollectionService {
  private readonly logger = new Logger(PaymentCollectionService.name);
  private readonly paymentTimeoutMilliseconds: number;

  constructor(
    private readonly transactions: TransactionRunner,
    private readonly payments: PaymentAcceptanceStore,
    private readonly lifecycle: BookingPaymentLifecycleService,
    private readonly paymentQueryService: PaymentQueryService,
    private readonly auditLog: TransactionalAuditLog,
    configService: ConfigService,
    private readonly vnPay: VnPayGatewayService,
  ) {
    this.paymentTimeoutMilliseconds =
      configService.getOrThrow<number>('BOOKING_PAYMENT_TIMEOUT_MINUTES') *
      60 *
      1000;
  }

  async createVnPayPayment(
    customerId: string | undefined,
    bookingId: string,
    idempotencyKey: string | undefined,
    clientIp: string | undefined,
    body: CreateVnpayPaymentDto,
  ): Promise<OnlinePaymentResponse> {
    const activeCustomerId = this.requireActorId(customerId);
    this.validateId(bookingId, 'Booking id khong hop le.');
    const key = this.requireIdempotencyKey(idempotencyKey);
    const bankCode = this.optionalVnPayBankCode(body.bankCode);
    const locale = this.optionalVnPayLocale(body.locale);
    let paymentId: string;

    try {
      paymentId = await this.transactions.run(async (transaction) => {
        const booking = await this.getLockedBooking(transaction, bookingId);

        if (booking.customerId !== activeCustomerId) {
          throw new NotFoundException('Khong tim thay booking.');
        }

        const existingPayment = await this.payments.findByIdempotencyKey(
          transaction,
          key,
        );

        if (existingPayment !== null) {
          this.assertOnlineIdempotentReplay(existingPayment, bookingId);
          return existingPayment.id;
        }

        const now = new Date();

        await this.payments.expirePendingOnlineAttempts(
          transaction,
          booking.id,
          now,
        );

        if (
          await this.payments.hasPendingOnlineAttempt(transaction, booking.id)
        ) {
          throw new ConflictException(
            'Booking dang co giao dich VNPay cho xu ly.',
          );
        }

        assertBookingCanAcceptPayment(booking, this.paymentTimeoutMilliseconds);

        const expiresAt =
          booking.status === BookingStatus.PENDING_PAYMENT
            ? (booking.paymentExpiresAt ??
              new Date(
                booking.createdAt.getTime() + this.paymentTimeoutMilliseconds,
              ))
            : new Date(now.getTime() + this.paymentTimeoutMilliseconds);
        const payment = await this.payments.createPayment(transaction, {
          bookingId: booking.id,
          amount: booking.totalAmount,
          currency: 'VND',
          method: PaymentMethod.VNPAY,
          status: PaymentStatus.PENDING,
          gatewayName: 'VNPAY',
          gatewayReference: null,
          gatewayTransactionId: null,
          gatewayPaymentUrl: null,
          gatewayResponseCode: null,
          gatewayTransactionStatus: null,
          idempotencyKey: key,
          createdByUserId: null,
          paidAt: null,
          expiresAt,
        });
        const gatewayReference = `P${payment.id}`;
        const createdPayment = this.vnPay.createPaymentRequest({
          amount: payment.amount,
          transactionReference: gatewayReference,
          orderInfo: `Thanh toan booking ${booking.bookingCode}`,
          ipAddress: clientIp,
          locale,
          bankCode,
          createdAt: now,
          expiresAt,
        });

        payment.gatewayReference = gatewayReference;
        payment.gatewayPaymentUrl = createdPayment.redirectUrl;
        payment.gatewayTransactionDate = createdPayment.transactionDate;
        await this.payments.savePaymentState(transaction, payment);

        return payment.id;
      });
    } catch (error) {
      paymentId = await this.resolveOnlineIdempotencyConflict(
        error,
        key,
        bookingId,
      );
    }

    const payment = await this.payments.findPaymentSnapshot(paymentId);

    if (payment === null) {
      throw new NotFoundException('Khong tim thay payment.');
    }

    if (payment.gatewayPaymentUrl === null || payment.expiresAt === null) {
      throw new ConflictException('Giao dich VNPay khong hop le.');
    }

    return {
      payment: this.paymentQueryService.toCustomerResponse(payment),
      paymentUrl: payment.gatewayPaymentUrl,
      expiresAt: payment.expiresAt,
    };
  }

  async handleVnPayIpn(
    query: Record<string, unknown>,
    requestId?: string,
  ): Promise<VnPayIpnResponse> {
    const callback = this.validateVnPayCallback(query, 'IPN', requestId);

    if (callback.kind === 'INVALID_SIGNATURE') {
      return { RspCode: '97', Message: 'Invalid signature' };
    }

    if (callback.kind !== 'VALID') {
      return { RspCode: '99', Message: 'Input data required' };
    }

    const result = await this.processVnPayCallback(callback, requestId);

    if (result.outcome === 'NOT_FOUND') {
      return { RspCode: '01', Message: 'Order not found' };
    }

    if (result.outcome === 'INVALID_AMOUNT') {
      return { RspCode: '04', Message: 'Invalid amount' };
    }

    if (result.outcome === 'ALREADY_PROCESSED') {
      return { RspCode: '02', Message: 'Order already confirmed' };
    }

    if (result.outcome === 'ERROR') {
      return { RspCode: '99', Message: 'Unknown error' };
    }

    return { RspCode: '00', Message: 'Confirm Success' };
  }

  async handleVnPayReturn(
    query: Record<string, unknown>,
    requestId?: string,
  ): Promise<VnPayReturnResponse> {
    const callback = this.validateVnPayCallback(query, 'Return', requestId);

    if (callback.kind !== 'VALID') {
      return {
        validSignature: false,
        paymentId: null,
        bookingId: null,
        paymentStatus: null,
        responseCode: null,
        transactionStatus: null,
      };
    }

    // VNPay Return is a browser redirect and is not an authoritative payment
    // notification.  It may only read the current correlated payment state;
    // all payment/booking mutations are reserved for the IPN path above.
    const payment = await this.payments.findByGatewayReferenceSnapshot(
      callback.gatewayReference,
    );

    if (
      payment !== null &&
      toVnPayAmount(payment.amount) !== callback.vnpAmount
    ) {
      return {
        validSignature: true,
        paymentId: payment.id,
        bookingId: payment.bookingId,
        paymentStatus: payment.status,
        responseCode: callback.responseCode,
        transactionStatus: callback.transactionStatus,
      };
    }

    return {
      validSignature: true,
      paymentId: payment?.id ?? null,
      bookingId: payment?.bookingId ?? null,
      paymentStatus: payment?.status ?? null,
      responseCode: callback.responseCode,
      transactionStatus: callback.transactionStatus,
    };
  }

  async expirePendingOnlinePayments(now = new Date()): Promise<number> {
    return this.transactions.run(async (transaction) => {
      const payments = await this.payments.lockExpiredOnlinePayments(
        transaction,
        now,
        100,
      );

      for (const payment of payments) {
        payment.status = PaymentStatus.FAILED;
        payment.gatewayResponseCode = 'EXPIRED';
      }

      if (payments.length > 0) {
        await this.payments.savePaymentState(transaction, payments);
      }

      return payments.length;
    });
  }

  private validateVnPayCallback(
    query: Record<string, unknown>,
    source: 'IPN' | 'Return',
    requestId?: string,
  ): VnPayCallbackValidation {
    try {
      const verification = this.vnPay.verifyPaymentCallback(query);

      if (!verification.isValid) {
        return { kind: 'INVALID_SIGNATURE' };
      }

      const gatewayReference = verification.gatewayReference;
      const vnpAmount = verification.gatewayAmount;
      const responseCode = verification.providerResponseCode;
      const transactionStatus = verification.providerTransactionStatus;
      const transactionId = verification.providerTransactionId;

      if (
        gatewayReference === null ||
        vnpAmount === null ||
        responseCode === null ||
        transactionStatus === null ||
        transactionId === null
      ) {
        return { kind: 'INVALID_INPUT' };
      }

      const paidAt = verification.paidAt;

      if (
        responseCode === '00' &&
        transactionStatus === '00' &&
        paidAt === null
      ) {
        return { kind: 'INVALID_INPUT' };
      }

      return {
        kind: 'VALID',
        gatewayReference,
        vnpAmount,
        responseCode,
        transactionStatus,
        transactionId,
        paidAt,
      };
    } catch (error) {
      this.logger.error(
        `operation=VNPAY_CALLBACK_VERIFY source=${source} paymentId=unknown bookingId=unknown errorCode=CALLBACK_VERIFICATION_FAILED requestId=${requestId ?? 'unknown'}`,
        getErrorStack(error),
      );
      return { kind: 'ERROR' };
    }
  }

  private async processVnPayCallback(
    callback: ValidVnPayCallback,
    requestId?: string,
  ): Promise<VnPayCallbackProcessResult> {
    let paymentSnapshot: Payment | null = null;
    let reviewReason: PaymentReviewReason | null = null;

    try {
      paymentSnapshot = await this.payments.findByGatewayReferenceSnapshot(
        callback.gatewayReference,
      );

      if (paymentSnapshot === null) {
        return {
          outcome: 'NOT_FOUND',
          paymentId: null,
          bookingId: null,
        };
      }

      const activePaymentSnapshot = paymentSnapshot;

      if (toVnPayAmount(activePaymentSnapshot.amount) !== callback.vnpAmount) {
        return {
          outcome: 'INVALID_AMOUNT',
          paymentId: activePaymentSnapshot.id,
          bookingId: activePaymentSnapshot.bookingId,
        };
      }

      const outcome = await this.transactions.run(async (transaction) => {
        const booking = await this.getLockedBooking(
          transaction,
          activePaymentSnapshot.bookingId,
        );
        const payment = await this.payments.lockPayment(
          transaction,
          activePaymentSnapshot.id,
        );

        if (payment === null) {
          return 'NOT_FOUND' as const;
        }

        if (toVnPayAmount(payment.amount) !== callback.vnpAmount) {
          return 'INVALID_AMOUNT' as const;
        }

        const successful =
          callback.responseCode === '00' && callback.transactionStatus === '00';
        const lateSuccess =
          successful &&
          payment.status === PaymentStatus.FAILED &&
          (payment.gatewayResponseCode === 'EXPIRED' ||
            payment.gatewayResponseCode === 'CANCELLED');

        if (payment.status !== PaymentStatus.PENDING && !lateSuccess) {
          return 'ALREADY_PROCESSED' as const;
        }

        payment.gatewayResponseCode = callback.responseCode;
        payment.gatewayTransactionStatus = callback.transactionStatus;

        const canonicalPayment = successful
          ? await this.payments.lockCanonicalPayment(
              transaction,
              booking.id,
              payment.id,
            )
          : null;

        if (!successful) {
          payment.status = PaymentStatus.FAILED;
          payment.reviewReason = null;
          payment.reviewCanonicalPaymentId = null;
          await this.payments.savePaymentState(transaction, payment);
          return 'PROCESSED' as const;
        }

        const applied = await this.lifecycle.applyGatewayPaymentOutcome(
          transaction,
          {
            booking,
            payment,
            canonicalPaymentId: canonicalPayment?.id ?? null,
            transactionId: callback.transactionId,
            paidAt: callback.paidAt,
            requestId,
          },
        );
        reviewReason = applied.reviewReason;
        return applied.outcome;
      });

      if (outcome === 'REQUIRES_REVIEW') {
        this.logger.warn(
          `operation=VNPAY_CALLBACK_PROCESS source=IPN paymentId=${activePaymentSnapshot.id} bookingId=${activePaymentSnapshot.bookingId} errorCode=REQUIRES_REVIEW requestId=${requestId ?? 'unknown'} reason=${reviewReason ?? 'UNKNOWN'}`,
        );
      }

      return {
        outcome,
        paymentId: activePaymentSnapshot.id,
        bookingId: activePaymentSnapshot.bookingId,
      };
    } catch (error) {
      this.logger.error(
        `operation=VNPAY_CALLBACK_PROCESS source=IPN paymentId=${paymentSnapshot?.id ?? 'unknown'} bookingId=${paymentSnapshot?.bookingId ?? 'unknown'} errorCode=CALLBACK_PROCESSING_FAILED requestId=${requestId ?? 'unknown'}`,
        getErrorStack(error),
      );

      return {
        outcome: 'ERROR',
        paymentId: paymentSnapshot?.id ?? null,
        bookingId: paymentSnapshot?.bookingId ?? null,
      };
    }
  }

  private assertOnlineIdempotentReplay(
    payment: Payment,
    bookingId: string,
  ): void {
    if (
      payment.bookingId !== bookingId ||
      payment.method !== PaymentMethod.VNPAY ||
      payment.createdByUserId !== null
    ) {
      throw new ConflictException(
        'Idempotency-Key da duoc su dung cho request khac.',
      );
    }
  }

  private async resolveOnlineIdempotencyConflict(
    error: unknown,
    key: string,
    bookingId: string,
  ): Promise<string> {
    if (!(error instanceof PaymentIdempotencyConflictError)) {
      throw error;
    }

    const payment = await this.payments.findByIdempotencyKeySnapshot(key);

    if (payment === null) {
      throw new ConflictException('Khong the tao giao dich trung lap.');
    }

    this.assertOnlineIdempotentReplay(payment, bookingId);
    return payment.id;
  }

  private async getLockedBooking(
    context: TransactionContext,
    bookingId: string,
  ) {
    const booking = await this.payments.lockBooking(context, bookingId);

    if (booking === null) {
      throw new NotFoundException('Khong tim thay booking.');
    }

    return booking;
  }

  private optionalVnPayBankCode(value: unknown): VnPayBankCode | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    if (value !== 'VNPAYQR' && value !== 'VNBANK' && value !== 'INTCARD') {
      throw new BadRequestException('Ma ngan hang VNPay khong hop le.');
    }

    return value;
  }

  private optionalVnPayLocale(value: unknown): VnPayLocale {
    if (value === undefined || value === null || value === '') {
      return 'vn';
    }

    if (value !== 'vn' && value !== 'en') {
      throw new BadRequestException('Ngon ngu VNPay khong hop le.');
    }

    return value;
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

function getErrorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}
