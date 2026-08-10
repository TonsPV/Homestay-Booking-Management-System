import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type Repository } from 'typeorm';

import { getMysqlDuplicateKey } from '../../common/database';
import { requireTrimmedString } from '../../common/validation';
import { AuditLogService } from '../audit/audit-log.service';
import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
} from '../audit/schema/audit-log.entity';
import {
  Booking,
  BookingPaymentStatus,
  BookingStatus,
} from '../booking/schema/booking.entity';
import { CreateVnpayPaymentDto } from './dto/create-vnpay-payment.dto';
import {
  assertBookingCanAcceptPayment,
  failExpiredOnlinePaymentsForBooking,
  getLockedPaymentBooking,
} from './payment-booking-policy';
import { PaymentQueryService } from './payment-query.service';
import type {
  OnlinePaymentResponse,
  VnPayIpnResponse,
  VnPayReturnResponse,
} from './payment.types';
import {
  Payment,
  PaymentMethod,
  PaymentReviewReason,
  PaymentStatus,
} from './schema/payment.entity';
import {
  formatVnPayDate,
  parseVnPayDate,
  VnPayGatewayService,
  type VnPayBankCode,
} from './vnpay-gateway.service';

type VnPayCallbackValidation =
  | {
      kind: 'VALID';
      parameters: Record<string, string>;
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
    private readonly dataSource: DataSource,
    @InjectRepository(Payment)
    private readonly paymentsRepository: Repository<Payment>,
    private readonly paymentQueryService: PaymentQueryService,
    private readonly auditLogService: AuditLogService,
    configService: ConfigService,
    private readonly vnPayGatewayService: VnPayGatewayService,
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
      paymentId = await this.dataSource.transaction(async (manager) => {
        const booking = await getLockedPaymentBooking(manager, bookingId);

        if (booking.customerId !== activeCustomerId) {
          throw new NotFoundException('Khong tim thay booking.');
        }

        const paymentsRepository = manager.getRepository(Payment);
        const existingPayment = await paymentsRepository.findOneBy({
          idempotencyKey: key,
        });

        if (existingPayment !== null) {
          this.assertOnlineIdempotentReplay(existingPayment, bookingId);
          return existingPayment.id;
        }

        const now = new Date();

        await failExpiredOnlinePaymentsForBooking(manager, booking.id, now);

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

        const expiresAt =
          booking.status === BookingStatus.PENDING_PAYMENT
            ? (booking.paymentExpiresAt ??
              new Date(
                booking.createdAt.getTime() + this.paymentTimeoutMilliseconds,
              ))
            : new Date(now.getTime() + this.paymentTimeoutMilliseconds);
        const payment = await paymentsRepository.save(
          paymentsRepository.create({
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
            refundedByUserId: null,
            paidAt: null,
            refundedAt: null,
            expiresAt,
          }),
        );
        const gatewayReference = `P${payment.id}`;
        const paymentUrl = this.vnPayGatewayService.createPaymentUrl({
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
        payment.gatewayPaymentUrl = paymentUrl;
        payment.gatewayTransactionDate = formatVnPayDate(now);
        await paymentsRepository.save(payment);

        return payment.id;
      });
    } catch (error) {
      paymentId = await this.resolveOnlineIdempotencyConflict(
        error,
        key,
        bookingId,
      );
    }

    const payment = await this.paymentQueryService.getPaymentEntity(paymentId);

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

    const result = await this.processVnPayCallback(callback, 'IPN', requestId);

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

    const processed = await this.processVnPayCallback(
      callback,
      'Return',
      requestId,
    );
    const payment =
      processed.paymentId === null
        ? null
        : await this.paymentsRepository.findOneBy({
            id: processed.paymentId,
          });

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
    return this.dataSource.transaction(async (manager) => {
      const paymentsRepository = manager.getRepository(Payment);
      const payments = await paymentsRepository
        .createQueryBuilder('payment')
        .setLock('pessimistic_write')
        .where('payment.method = :method', {
          method: PaymentMethod.VNPAY,
        })
        .andWhere('payment.status = :status', {
          status: PaymentStatus.PENDING,
        })
        .andWhere('payment.expiresAt IS NOT NULL')
        .andWhere('payment.expiresAt <= :now', { now })
        .orderBy('payment.id', 'ASC')
        .take(100)
        .getMany();

      for (const payment of payments) {
        payment.status = PaymentStatus.FAILED;
        payment.gatewayResponseCode = 'EXPIRED';
      }

      if (payments.length > 0) {
        await paymentsRepository.save(payments);
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
      const verified = this.vnPayGatewayService.verifyCallback(query);

      if (
        !verified.isValid ||
        verified.parameters.vnp_TmnCode !==
          this.vnPayGatewayService.getTmnCode()
      ) {
        return { kind: 'INVALID_SIGNATURE' };
      }

      const parameters = verified.parameters;
      const gatewayReference = parameters.vnp_TxnRef;
      const vnpAmount = parameters.vnp_Amount;
      const responseCode = parameters.vnp_ResponseCode;
      const transactionStatus = parameters.vnp_TransactionStatus;
      const transactionId = parameters.vnp_TransactionNo;

      if (
        gatewayReference === undefined ||
        vnpAmount === undefined ||
        responseCode === undefined ||
        transactionStatus === undefined ||
        transactionId === undefined
      ) {
        return { kind: 'INVALID_INPUT' };
      }

      const paidAt = parseVnPayDate(parameters.vnp_PayDate);

      if (
        responseCode === '00' &&
        transactionStatus === '00' &&
        paidAt === null
      ) {
        return { kind: 'INVALID_INPUT' };
      }

      return {
        kind: 'VALID',
        parameters,
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
    source: 'IPN' | 'Return',
    requestId?: string,
  ): Promise<VnPayCallbackProcessResult> {
    let paymentSnapshot: Payment | null = null;
    let reviewReason: PaymentReviewReason | null = null;

    try {
      paymentSnapshot = await this.paymentsRepository.findOneBy({
        gatewayReference: callback.gatewayReference,
      });

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

      const outcome = await this.dataSource.transaction(async (manager) => {
        const booking = await getLockedPaymentBooking(
          manager,
          activePaymentSnapshot.bookingId,
        );
        const payment = await manager
          .getRepository(Payment)
          .createQueryBuilder('payment')
          .setLock('pessimistic_write')
          .where('payment.id = :paymentId', {
            paymentId: activePaymentSnapshot.id,
          })
          .getOne();

        if (payment === null) {
          return 'NOT_FOUND' as const;
        }

        if (toVnPayAmount(payment.amount) !== callback.vnpAmount) {
          return 'INVALID_AMOUNT' as const;
        }

        const successful =
          callback.responseCode === '00' && callback.transactionStatus === '00';
        const bookingFromStatus = booking.status;
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
          ? await manager
              .getRepository(Payment)
              .createQueryBuilder('canonicalPayment')
              .setLock('pessimistic_write')
              .where('canonicalPayment.bookingId = :bookingId', {
                bookingId: booking.id,
              })
              .andWhere('canonicalPayment.id <> :paymentId', {
                paymentId: payment.id,
              })
              .andWhere('canonicalPayment.status = :status', {
                status: PaymentStatus.SUCCESS,
              })
              .orderBy('canonicalPayment.id', 'ASC')
              .getOne()
          : null;

        if (
          successful &&
          (booking.status === BookingStatus.CANCELLED ||
            canonicalPayment !== null)
        ) {
          reviewReason =
            booking.status === BookingStatus.CANCELLED
              ? PaymentReviewReason.BOOKING_CANCELLED
              : PaymentReviewReason.ANOTHER_SUCCESSFUL_PAYMENT;
          payment.status = PaymentStatus.REQUIRES_REVIEW;
          payment.reviewReason = reviewReason;
          payment.reviewCanonicalPaymentId =
            reviewReason === PaymentReviewReason.ANOTHER_SUCCESSFUL_PAYMENT
              ? (canonicalPayment?.id ?? null)
              : null;
          payment.gatewayTransactionId = callback.transactionId;
          payment.paidAt = callback.paidAt;
          await manager.getRepository(Payment).save(payment);
          await this.auditLogService.record(manager, {
            actorType: AuditActorType.SYSTEM,
            actorId: null,
            action: AuditAction.PAYMENT_CONFIRMED,
            entityType: AuditEntityType.PAYMENT,
            entityId: payment.id,
            requestId,
            metadata: {
              bookingId: booking.id,
              source,
              paymentStatus: payment.status,
              reviewReason: reviewReason ?? 'UNKNOWN',
            },
          });

          return 'REQUIRES_REVIEW' as const;
        }

        if (successful) {
          payment.status = PaymentStatus.SUCCESS;
          payment.reviewReason = null;
          payment.reviewCanonicalPaymentId = null;
          payment.gatewayTransactionId = callback.transactionId;
          payment.paidAt = callback.paidAt;

          booking.paymentStatus = BookingPaymentStatus.PAID;
          booking.paymentExpiresAt = null;

          if (booking.status === BookingStatus.PENDING_PAYMENT) {
            booking.status = BookingStatus.CONFIRMED;
          }
        } else {
          payment.status = PaymentStatus.FAILED;
          payment.reviewReason = null;
          payment.reviewCanonicalPaymentId = null;
        }

        await manager.getRepository(Payment).save(payment);
        await manager.getRepository(Booking).save(booking);

        if (successful) {
          await this.auditLogService.record(manager, {
            actorType: AuditActorType.SYSTEM,
            actorId: null,
            action: AuditAction.PAYMENT_CONFIRMED,
            entityType: AuditEntityType.PAYMENT,
            entityId: payment.id,
            requestId,
            metadata: {
              bookingId: booking.id,
              source,
              paymentStatus: payment.status,
            },
          });
          if (bookingFromStatus !== booking.status) {
            await this.auditLogService.record(manager, {
              actorType: AuditActorType.SYSTEM,
              actorId: null,
              action: AuditAction.BOOKING_STATUS_CHANGED,
              entityType: AuditEntityType.BOOKING,
              entityId: booking.id,
              requestId,
              metadata: {
                fromStatus: bookingFromStatus,
                toStatus: booking.status,
                paymentId: payment.id,
              },
            });
          }
        }

        return 'PROCESSED' as const;
      });

      if (outcome === 'REQUIRES_REVIEW') {
        this.logger.warn(
          `operation=VNPAY_CALLBACK_PROCESS source=${source} paymentId=${activePaymentSnapshot.id} bookingId=${activePaymentSnapshot.bookingId} errorCode=REQUIRES_REVIEW requestId=${requestId ?? 'unknown'} reason=${reviewReason ?? 'UNKNOWN'}`,
        );
      }

      return {
        outcome,
        paymentId: activePaymentSnapshot.id,
        bookingId: activePaymentSnapshot.bookingId,
      };
    } catch (error) {
      this.logger.error(
        `operation=VNPAY_CALLBACK_PROCESS source=${source} paymentId=${paymentSnapshot?.id ?? 'unknown'} bookingId=${paymentSnapshot?.bookingId ?? 'unknown'} errorCode=CALLBACK_PROCESSING_FAILED requestId=${requestId ?? 'unknown'}`,
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
      throw new ConflictException('Khong the tao giao dich trung lap.');
    }

    this.assertOnlineIdempotentReplay(payment, bookingId);
    return payment.id;
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

  private optionalVnPayLocale(value: unknown): 'vn' | 'en' {
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

function toVnPayAmount(amount: string): string {
  const match = /^([0-9]+)[.]([0-9]{2})$/.exec(amount);

  if (match === null) {
    throw new Error('Payment amount is invalid.');
  }

  return (BigInt(match[1]) * 100n + BigInt(match[2])).toString();
}

function getErrorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}
