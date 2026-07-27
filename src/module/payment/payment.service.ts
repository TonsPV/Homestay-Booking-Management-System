import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  DataSource,
  type EntityManager,
  type Repository,
  type SelectQueryBuilder,
} from 'typeorm';

import { getMysqlDuplicateKey } from '../../common/database';
import type { PaginationMeta } from '../../common/http';
import {
  optionalNullableTrimmedString,
  parsePagination,
  requireTrimmedString,
} from '../../common/validation';
import {
  Booking,
  BookingPaymentStatus,
  BookingStatus,
} from '../booking/schema/booking.entity';
import { RoomCalendar } from '../booking/schema/room-calendar.entity';
import { CreateManualPaymentDto } from './dto/create-manual-payment.dto';
import { CreateVnpayPaymentDto } from './dto/create-vnpay-payment.dto';
import { ListPaymentsQueryDto } from './dto/list-payments-query.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { Payment, PaymentMethod, PaymentStatus } from './schema/payment.entity';
import {
  formatVnPayDate,
  parseVnPayDate,
  VnPayGatewayService,
  type VnPayBankCode,
  type VnPayGatewayOperationResult,
} from './vnpay-gateway.service';

interface PaymentListResult {
  items: PaymentResponse[];
  meta: PaginationMeta;
}

export interface OnlinePaymentResponse {
  payment: PaymentResponse;
  paymentUrl: string;
  expiresAt: Date;
}

export interface VnPayIpnResponse {
  RspCode: '00' | '01' | '02' | '04' | '97' | '99';
  Message: string;
}

export interface VnPayReturnResponse {
  validSignature: boolean;
  paymentId: string | null;
  bookingId: string | null;
  paymentStatus: PaymentStatus | null;
  responseCode: string | null;
  transactionStatus: string | null;
}

type VnPayCallbackValidation =
  | {
      kind: 'VALID';
      parameters: Record<string, string>;
      gatewayReference: string;
      vnpAmount: string;
      responseCode: string;
      transactionStatus: string;
      transactionId: string;
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

export interface PaymentResponse {
  id: string;
  bookingId: string;
  amount: string;
  currency: 'VND';
  method: PaymentMethod;
  status: PaymentStatus;
  gatewayName: string | null;
  gatewayReference: string | null;
  gatewayTransactionId: string | null;
  gatewayResponseCode: string | null;
  gatewayTransactionStatus: string | null;
  gatewayTransactionDate: string | null;
  refundRequestId: string | null;
  refundPreviousStatus: PaymentStatus | null;
  refundGatewayTransactionId: string | null;
  refundResponseCode: string | null;
  refundTransactionStatus: string | null;
  refundMessage: string | null;
  refundReason: string | null;
  createdByUserId: string | null;
  refundedByUserId: string | null;
  paidAt: Date | null;
  refundedAt: Date | null;
  refundRequestedAt: Date | null;
  refundLastQueriedAt: Date | null;
  expiresAt: Date | null;
  createdByUser: {
    id: string;
    fullName: string;
  } | null;
  refundedByUser: {
    id: string;
    fullName: string;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);
  private readonly paymentTimeoutMilliseconds: number;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Payment)
    private readonly paymentsRepository: Repository<Payment>,
    @InjectRepository(Booking)
    private readonly bookingsRepository: Repository<Booking>,
    configService: ConfigService,
    private readonly vnPayGatewayService: VnPayGatewayService,
  ) {
    this.paymentTimeoutMilliseconds =
      configService.getOrThrow<number>('BOOKING_PAYMENT_TIMEOUT_MINUTES') *
      60 *
      1000;
  }

  async listForCustomer(
    customerId: string | undefined,
    bookingId: string,
    query: ListPaymentsQueryDto,
  ): Promise<PaymentListResult> {
    const activeCustomerId = this.requireActorId(customerId);
    this.validateId(bookingId, 'Booking id khong hop le.');
    const booking = await this.bookingsRepository.findOneBy({ id: bookingId });

    if (booking === null || booking.customerId !== activeCustomerId) {
      throw new NotFoundException('Khong tim thay booking.');
    }

    return this.listByBooking(bookingId, query);
  }

  async listManagement(
    bookingId: string,
    query: ListPaymentsQueryDto,
  ): Promise<PaymentListResult> {
    this.validateId(bookingId, 'Booking id khong hop le.');

    if (
      (await this.bookingsRepository.exists({
        where: { id: bookingId },
      })) === false
    ) {
      throw new NotFoundException('Khong tim thay booking.');
    }

    return this.listByBooking(bookingId, query);
  }

  async listAllManagement(
    query: ListPaymentsQueryDto,
  ): Promise<PaymentListResult> {
    return this.listPayments(query);
  }

  async recordManualPayment(
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
        const booking = await this.getLockedBooking(manager, bookingId);
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

        await this.failExpiredOnlinePaymentsForBooking(
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

        this.assertBookingCanBePaid(booking);

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

    return this.getManagementPayment(paymentId);
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
        const booking = await this.getLockedBooking(manager, bookingId);

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

        await this.failExpiredOnlinePaymentsForBooking(
          manager,
          booking.id,
          now,
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

        this.assertBookingCanBePaid(booking);

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

    const payment = await this.getPaymentEntity(paymentId);

    if (payment.gatewayPaymentUrl === null || payment.expiresAt === null) {
      throw new ConflictException('Giao dich VNPay khong hop le.');
    }

    return {
      payment: this.toResponse(payment),
      paymentUrl: payment.gatewayPaymentUrl,
      expiresAt: payment.expiresAt,
    };
  }

  async handleVnPayIpn(
    query: Record<string, unknown>,
  ): Promise<VnPayIpnResponse> {
    const callback = this.validateVnPayCallback(query, 'IPN');

    if (callback.kind === 'INVALID_SIGNATURE') {
      return { RspCode: '97', Message: 'Invalid signature' };
    }

    if (callback.kind !== 'VALID') {
      return { RspCode: '99', Message: 'Input data required' };
    }

    const result = await this.processVnPayCallback(callback, 'IPN');

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
  ): Promise<VnPayReturnResponse> {
    const callback = this.validateVnPayCallback(query, 'Return');

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

    const processed = await this.processVnPayCallback(callback, 'Return');
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

  private validateVnPayCallback(
    query: Record<string, unknown>,
    source: 'IPN' | 'Return',
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

      return {
        kind: 'VALID',
        parameters,
        gatewayReference,
        vnpAmount,
        responseCode,
        transactionStatus,
        transactionId,
      };
    } catch (error) {
      this.logger.error(
        `Failed to verify VNPay ${source} callback.`,
        getErrorStack(error),
      );
      return { kind: 'ERROR' };
    }
  }

  private async processVnPayCallback(
    callback: ValidVnPayCallback,
    source: 'IPN' | 'Return',
  ): Promise<VnPayCallbackProcessResult> {
    let paymentSnapshot: Payment | null = null;

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
        const booking = await this.getLockedBooking(
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

        if (successful && booking.status === BookingStatus.CANCELLED) {
          payment.status = PaymentStatus.REQUIRES_REVIEW;
          payment.gatewayTransactionId = callback.transactionId;
          payment.paidAt =
            parseVnPayDate(callback.parameters.vnp_PayDate) ?? new Date();
          await manager.getRepository(Payment).save(payment);

          return 'REQUIRES_REVIEW' as const;
        }

        if (successful) {
          payment.status = PaymentStatus.SUCCESS;
          payment.gatewayTransactionId = callback.transactionId;
          payment.paidAt =
            parseVnPayDate(callback.parameters.vnp_PayDate) ?? new Date();

          booking.paymentStatus = BookingPaymentStatus.PAID;
          booking.paymentExpiresAt = null;

          if (booking.status === BookingStatus.PENDING_PAYMENT) {
            booking.status = BookingStatus.CONFIRMED;
          }
        } else {
          payment.status = PaymentStatus.FAILED;
        }

        await manager.getRepository(Payment).save(payment);
        await manager.getRepository(Booking).save(booking);

        return 'PROCESSED' as const;
      });

      if (outcome === 'REQUIRES_REVIEW') {
        this.logger.warn(
          `VNPay ${source} marked payment ${activePaymentSnapshot.id} for review after booking ${activePaymentSnapshot.bookingId} was cancelled.`,
        );
      }

      return {
        outcome,
        paymentId: activePaymentSnapshot.id,
        bookingId: activePaymentSnapshot.bookingId,
      };
    } catch (error) {
      this.logger.error(
        `Failed to process VNPay ${source} callback for payment ${paymentSnapshot?.id ?? 'unknown'}.`,
        getErrorStack(error),
      );

      return {
        outcome: 'ERROR',
        paymentId: paymentSnapshot?.id ?? null,
        bookingId: paymentSnapshot?.bookingId ?? null,
      };
    }
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

  async refund(
    userId: string | undefined,
    paymentId: string,
    idempotencyKey: string | undefined,
    clientIp: string | undefined,
    body: RefundPaymentDto,
  ): Promise<PaymentResponse> {
    const refundedByUserId = this.requireActorId(userId);
    this.validateId(paymentId, 'Payment id khong hop le.');
    const reason =
      optionalNullableTrimmedString(
        body.reason,
        'Ly do hoan tien khong hop le.',
        500,
      ) ?? 'Payment refunded.';
    const paymentSnapshot = await this.paymentsRepository.findOneBy({
      id: paymentId,
    });

    if (paymentSnapshot === null) {
      throw new NotFoundException('Khong tim thay payment.');
    }

    if (paymentSnapshot.method === PaymentMethod.VNPAY) {
      return this.refundVnPay(
        refundedByUserId,
        paymentSnapshot,
        this.requireIdempotencyKey(idempotencyKey),
        clientIp,
        reason,
      );
    }

    return this.refundManual(refundedByUserId, paymentSnapshot, reason);
  }

  async reconcileVnPayRefund(
    userId: string | undefined,
    paymentId: string,
    clientIp: string | undefined,
  ): Promise<PaymentResponse> {
    this.requireActorId(userId);
    this.validateId(paymentId, 'Payment id khong hop le.');
    const payment = await this.getPaymentEntity(paymentId);

    if (
      payment.method !== PaymentMethod.VNPAY ||
      payment.status !== PaymentStatus.REFUND_PENDING
    ) {
      throw new ConflictException(
        'Payment hien khong co refund VNPay cho doi soat.',
      );
    }

    const operationInput = this.getVnPayOperationInput(
      payment,
      createVnPayRequestId('Q'),
      clientIp,
      `Doi soat refund payment ${payment.id}`,
    );

    if (payment.refundGatewayTransactionId !== null) {
      operationInput.transactionId = payment.refundGatewayTransactionId;
    }
    let result: VnPayGatewayOperationResult;

    try {
      result = await this.vnPayGatewayService.queryTransaction(operationInput);
    } catch (error) {
      await this.recordRefundQueryFailure(payment.id);
      this.logger.error(
        `Failed to reconcile VNPay refund for payment ${payment.id}.`,
        getErrorStack(error),
      );
      throw new ServiceUnavailableException(
        'Khong the doi soat refund voi VNPay luc nay.',
      );
    }

    await this.applyVnPayReconciliation(payment.id, result);

    if (!result.isVerified) {
      throw new ServiceUnavailableException(
        'Phan hoi doi soat VNPay khong xac minh duoc chu ky.',
      );
    }

    return this.getManagementPayment(payment.id);
  }

  private async refundManual(
    refundedByUserId: string,
    paymentSnapshot: Payment,
    reason: string,
  ): Promise<PaymentResponse> {
    const paymentId = paymentSnapshot.id;

    await this.dataSource.transaction(async (manager) => {
      const booking = await this.getLockedBooking(
        manager,
        paymentSnapshot.bookingId,
      );
      const payment = await manager
        .getRepository(Payment)
        .createQueryBuilder('payment')
        .setLock('pessimistic_write')
        .where('payment.id = :paymentId', { paymentId })
        .getOne();

      if (payment === null) {
        throw new NotFoundException('Khong tim thay payment.');
      }

      if (payment.status === PaymentStatus.REFUNDED) {
        return;
      }

      if (
        payment.status !== PaymentStatus.SUCCESS ||
        booking.paymentStatus !== BookingPaymentStatus.PAID
      ) {
        throw new ConflictException('Payment hien khong the hoan tien.');
      }

      if (
        booking.status === BookingStatus.CHECKED_IN ||
        booking.status === BookingStatus.CHECKED_OUT ||
        booking.status === BookingStatus.CANCELLED
      ) {
        throw new ConflictException(
          'Khong the hoan tien booking o trang thai hien tai.',
        );
      }

      const now = new Date();
      payment.status = PaymentStatus.REFUNDED;
      payment.refundedByUserId = refundedByUserId;
      payment.refundedAt = now;
      payment.refundReason = reason;
      booking.paymentStatus = BookingPaymentStatus.REFUNDED;
      booking.paymentExpiresAt = null;
      booking.status = BookingStatus.CANCELLED;
      booking.cancelledAt = now;
      booking.cancellationReason = reason;

      await manager.getRepository(Payment).save(payment);
      await manager.getRepository(Booking).save(booking);
      await manager.getRepository(RoomCalendar).delete({
        bookingId: booking.id,
      });
    });

    return this.getManagementPayment(paymentId);
  }

  private async refundVnPay(
    refundedByUserId: string,
    paymentSnapshot: Payment,
    idempotencyKey: string,
    clientIp: string | undefined,
    reason: string,
  ): Promise<PaymentResponse> {
    const preparation = await this.prepareVnPayRefund(
      refundedByUserId,
      paymentSnapshot,
      idempotencyKey,
      reason,
    );

    if (preparation === 'REFUNDED') {
      return this.getManagementPayment(paymentSnapshot.id);
    }

    if (preparation === 'REJECTED_REPLAY') {
      throw new ConflictException('Yeu cau hoan tien VNPay nay da bi tu choi.');
    }

    if (preparation === 'PENDING_REPLAY') {
      return this.reconcileVnPayRefund(
        refundedByUserId,
        paymentSnapshot.id,
        clientIp,
      );
    }

    const pendingPayment = await this.getPaymentEntity(paymentSnapshot.id);
    const operationInput = this.getVnPayOperationInput(
      pendingPayment,
      pendingPayment.refundRequestId as string,
      clientIp,
      `Hoan tien booking ${pendingPayment.bookingId}: ${reason}`,
    );
    let result: VnPayGatewayOperationResult;

    try {
      result = await this.vnPayGatewayService.refundFull({
        ...operationInput,
        createdBy: `user-${refundedByUserId}`,
      });
    } catch (error) {
      this.logger.error(
        `VNPay refund request failed for payment ${pendingPayment.id}.`,
        getErrorStack(error),
      );
      throw new ServiceUnavailableException(
        'Chua xac dinh duoc ket qua hoan tien VNPay. Hay doi soat truoc khi thu lai.',
      );
    }

    const outcome = await this.applyVnPayRefundResult(
      pendingPayment.id,
      result,
    );

    if (outcome === 'SUCCESS') {
      return this.getManagementPayment(pendingPayment.id);
    }

    if (outcome === 'REJECTED') {
      throw new ConflictException(`VNPay tu choi hoan tien: ${result.message}`);
    }

    if (this.isAcceptedVnPayRefund(paymentSnapshot, result)) {
      return this.getManagementPayment(pendingPayment.id);
    }

    throw new ServiceUnavailableException(
      'Chua xac dinh duoc ket qua hoan tien VNPay. Hay thuc hien doi soat.',
    );
  }

  private async prepareVnPayRefund(
    refundedByUserId: string,
    paymentSnapshot: Payment,
    idempotencyKey: string,
    reason: string,
  ): Promise<'NEW' | 'PENDING_REPLAY' | 'REJECTED_REPLAY' | 'REFUNDED'> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const booking = await this.getLockedBooking(
          manager,
          paymentSnapshot.bookingId,
        );
        const paymentsRepository = manager.getRepository(Payment);
        const payment = await paymentsRepository
          .createQueryBuilder('payment')
          .setLock('pessimistic_write')
          .where('payment.id = :paymentId', { paymentId: paymentSnapshot.id })
          .getOne();

        if (payment === null) {
          throw new NotFoundException('Khong tim thay payment.');
        }

        const paymentUsingKey = await paymentsRepository.findOneBy({
          refundIdempotencyKey: idempotencyKey,
        });

        if (paymentUsingKey !== null && paymentUsingKey.id !== payment.id) {
          throw new ConflictException(
            'Idempotency-Key da duoc su dung cho request khac.',
          );
        }

        if (payment.status === PaymentStatus.REFUNDED) {
          return 'REFUNDED';
        }

        if (payment.status === PaymentStatus.REFUND_PENDING) {
          if (payment.refundIdempotencyKey !== idempotencyKey) {
            throw new ConflictException(
              'Payment dang co yeu cau hoan tien VNPay cho xu ly.',
            );
          }

          return 'PENDING_REPLAY';
        }

        if (payment.refundIdempotencyKey !== null) {
          if (
            payment.refundIdempotencyKey === idempotencyKey &&
            payment.refundResponseCode !== null
          ) {
            return 'REJECTED_REPLAY';
          }

          throw new ConflictException(
            'Payment da co mot yeu cau hoan tien VNPay truoc do.',
          );
        }

        this.assertVnPayRefundAllowed(booking, payment);
        const transactionDate = this.resolveGatewayTransactionDate(payment);

        const previousStatus = payment.status;

        payment.status = PaymentStatus.REFUND_PENDING;
        payment.gatewayTransactionDate = transactionDate;
        payment.refundIdempotencyKey = idempotencyKey;
        payment.refundRequestId = createVnPayRequestId('R');
        payment.refundPreviousStatus = previousStatus;
        payment.refundGatewayTransactionId = null;
        payment.refundResponseCode = null;
        payment.refundTransactionStatus = null;
        payment.refundMessage = null;
        payment.refundReason = reason;
        payment.refundRequestedAt = new Date();
        payment.refundLastQueriedAt = null;
        payment.refundedByUserId = refundedByUserId;
        payment.refundedAt = null;

        await paymentsRepository.save(payment);
        return 'NEW';
      });
    } catch (error) {
      const duplicateKey = getMysqlDuplicateKey(error);

      if (
        duplicateKey !== undefined &&
        duplicateKey.includes('payments_refund_idempotency')
      ) {
        throw new ConflictException(
          'Idempotency-Key da duoc su dung cho request khac.',
        );
      }

      throw error;
    }
  }

  private assertVnPayRefundAllowed(booking: Booking, payment: Payment): void {
    if (
      payment.gatewayReference === null ||
      payment.gatewayTransactionId === null
    ) {
      throw new ConflictException(
        'Payment VNPay thieu thong tin giao dich de hoan tien.',
      );
    }

    if (payment.status === PaymentStatus.REQUIRES_REVIEW) {
      if (booking.status !== BookingStatus.CANCELLED) {
        throw new ConflictException(
          'Payment can review nhung booking khong o trang thai da huy.',
        );
      }
      return;
    }

    if (
      payment.status !== PaymentStatus.SUCCESS ||
      booking.paymentStatus !== BookingPaymentStatus.PAID
    ) {
      throw new ConflictException('Payment hien khong the hoan tien.');
    }

    if (
      booking.status !== BookingStatus.PENDING_PAYMENT &&
      booking.status !== BookingStatus.CONFIRMED
    ) {
      throw new ConflictException(
        'Khong the hoan tien booking o trang thai hien tai.',
      );
    }
  }

  private getVnPayOperationInput(
    payment: Payment,
    requestId: string,
    clientIp: string | undefined,
    orderInfo: string,
  ) {
    if (
      payment.gatewayReference === null ||
      payment.gatewayTransactionId === null
    ) {
      throw new ConflictException('Payment VNPay thieu thong tin giao dich.');
    }

    return {
      amount: payment.amount,
      transactionReference: payment.gatewayReference,
      transactionId: payment.gatewayTransactionId,
      transactionDate: this.resolveGatewayTransactionDate(payment),
      requestId,
      orderInfo,
      ipAddress: clientIp,
      createdAt: new Date(),
    };
  }

  private resolveGatewayTransactionDate(payment: Payment): string {
    if (
      payment.gatewayTransactionDate !== null &&
      /^\d{14}$/.test(payment.gatewayTransactionDate)
    ) {
      return payment.gatewayTransactionDate;
    }

    if (payment.gatewayPaymentUrl !== null) {
      try {
        const value = new URL(payment.gatewayPaymentUrl).searchParams.get(
          'vnp_CreateDate',
        );

        if (value !== null && /^\d{14}$/.test(value)) {
          return value;
        }
      } catch {
        // Invalid legacy URLs are handled by the explicit error below.
      }
    }

    throw new ConflictException(
      'Payment VNPay thieu ngay giao dich goc de hoan tien.',
    );
  }

  private async applyVnPayRefundResult(
    paymentId: string,
    result: VnPayGatewayOperationResult,
  ): Promise<'SUCCESS' | 'REJECTED' | 'PENDING'> {
    return this.dataSource.transaction(async (manager) => {
      const paymentSnapshot = await manager
        .getRepository(Payment)
        .findOneBy({ id: paymentId });

      if (paymentSnapshot === null) {
        throw new NotFoundException('Khong tim thay payment.');
      }

      const booking = await this.getLockedBooking(
        manager,
        paymentSnapshot.bookingId,
      );
      const paymentsRepository = manager.getRepository(Payment);
      const payment = await paymentsRepository
        .createQueryBuilder('payment')
        .setLock('pessimistic_write')
        .where('payment.id = :paymentId', { paymentId })
        .getOne();

      if (payment === null) {
        throw new NotFoundException('Khong tim thay payment.');
      }

      if (payment.status === PaymentStatus.REFUNDED) {
        return 'SUCCESS';
      }

      if (payment.status !== PaymentStatus.REFUND_PENDING) {
        throw new ConflictException(
          'Payment khong con cho ket qua hoan tien VNPay.',
        );
      }

      this.assignRefundGatewayResult(payment, result);

      if (this.isSuccessfulVnPayRefund(payment, result)) {
        await this.completeRefund(manager, booking, payment);
        return 'SUCCESS';
      }

      if (this.isAmbiguousVnPayResult(result)) {
        await paymentsRepository.save(payment);
        return 'PENDING';
      }

      payment.status =
        payment.refundPreviousStatus === PaymentStatus.REQUIRES_REVIEW
          ? PaymentStatus.REQUIRES_REVIEW
          : PaymentStatus.SUCCESS;
      await paymentsRepository.save(payment);
      return 'REJECTED';
    });
  }

  private async applyVnPayReconciliation(
    paymentId: string,
    result: VnPayGatewayOperationResult,
  ): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const paymentSnapshot = await manager
        .getRepository(Payment)
        .findOneBy({ id: paymentId });

      if (paymentSnapshot === null) {
        throw new NotFoundException('Khong tim thay payment.');
      }

      const booking = await this.getLockedBooking(
        manager,
        paymentSnapshot.bookingId,
      );
      const payment = await manager
        .getRepository(Payment)
        .createQueryBuilder('payment')
        .setLock('pessimistic_write')
        .where('payment.id = :paymentId', { paymentId })
        .getOne();

      if (payment === null || payment.status !== PaymentStatus.REFUND_PENDING) {
        return;
      }

      payment.refundLastQueriedAt = new Date();

      if (this.isSuccessfulVnPayRefund(payment, result)) {
        this.assignRefundGatewayResult(payment, result);
        await this.completeRefund(manager, booking, payment);
        return;
      }

      if (result.transactionType === '02') {
        this.assignRefundGatewayResult(payment, result);
      } else {
        payment.refundMessage =
          `QueryDr did not return a refund transaction: ${result.message}`.slice(
            0,
            255,
          );
      }

      await manager.getRepository(Payment).save(payment);
    });
  }

  private assignRefundGatewayResult(
    payment: Payment,
    result: VnPayGatewayOperationResult,
  ): void {
    payment.refundGatewayTransactionId = result.transactionId;
    payment.refundResponseCode = result.responseCode;
    payment.refundTransactionStatus = result.transactionStatus;
    payment.refundMessage = result.message.slice(0, 255);
  }

  private isSuccessfulVnPayRefund(
    payment: Payment,
    result: VnPayGatewayOperationResult,
  ): boolean {
    return (
      result.isVerified &&
      result.isSuccess &&
      result.responseCode === '00' &&
      result.transactionStatus === '00' &&
      result.transactionType === '02' &&
      isMatchingVnPayOperationAmount(payment.amount, result.amount)
    );
  }

  private isAmbiguousVnPayResult(result: VnPayGatewayOperationResult): boolean {
    return (
      !result.isVerified ||
      result.responseCode === null ||
      result.responseCode === '94' ||
      result.responseCode === '98' ||
      result.responseCode === '99' ||
      result.transactionStatus === '05' ||
      result.transactionStatus === '06'
    );
  }

  private isAcceptedVnPayRefund(
    payment: Payment,
    result: VnPayGatewayOperationResult,
  ): boolean {
    return (
      result.isVerified &&
      result.isSuccess &&
      result.responseCode === '00' &&
      (result.transactionStatus === '05' ||
        result.transactionStatus === '06') &&
      result.transactionType === '02' &&
      isMatchingVnPayOperationAmount(payment.amount, result.amount)
    );
  }

  private async completeRefund(
    manager: EntityManager,
    booking: Booking,
    payment: Payment,
  ): Promise<void> {
    const now = new Date();

    payment.status = PaymentStatus.REFUNDED;
    payment.refundedAt = now;
    booking.paymentStatus = BookingPaymentStatus.REFUNDED;
    booking.paymentExpiresAt = null;

    if (booking.status !== BookingStatus.CANCELLED) {
      booking.status = BookingStatus.CANCELLED;
      booking.cancelledAt = now;
      booking.cancellationReason = payment.refundReason ?? 'Payment refunded.';
    }

    await manager.getRepository(Payment).save(payment);
    await manager.getRepository(Booking).save(booking);
    await manager.getRepository(RoomCalendar).delete({
      bookingId: booking.id,
    });
  }

  private async recordRefundQueryFailure(paymentId: string): Promise<void> {
    await this.paymentsRepository.update(
      {
        id: paymentId,
        status: PaymentStatus.REFUND_PENDING,
      },
      {
        refundLastQueriedAt: new Date(),
        refundMessage: 'Khong the ket noi VNPay de doi soat.',
      },
    );
  }

  private async listByBooking(
    bookingId: string,
    query: ListPaymentsQueryDto,
  ): Promise<PaymentListResult> {
    return this.listPayments(query, bookingId);
  }

  private async listPayments(
    query: ListPaymentsQueryDto,
    bookingId?: string,
  ): Promise<PaymentListResult> {
    const { page, limit, skip } = parsePagination(
      query as Record<string, unknown>,
    );
    const status = this.optionalPaymentStatus(query.status);
    const method = this.optionalPaymentMethod(query.method);
    const paymentsQuery = this.createPaymentQuery()
      .orderBy('payment.createdAt', 'DESC')
      .addOrderBy('payment.id', 'DESC')
      .skip(skip)
      .take(limit);

    if (bookingId !== undefined) {
      paymentsQuery.andWhere('payment.bookingId = :bookingId', { bookingId });
    }

    if (status !== undefined) {
      paymentsQuery.andWhere('payment.status = :status', { status });
    }

    if (method !== undefined) {
      paymentsQuery.andWhere('payment.method = :method', { method });
    }

    const [payments, total] = await paymentsQuery.getManyAndCount();

    return {
      items: payments.map((payment) => this.toResponse(payment)),
      meta: {
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    };
  }

  private async getManagementPayment(id: string): Promise<PaymentResponse> {
    const payment = await this.getPaymentEntity(id);

    return this.toResponse(payment);
  }

  private async getPaymentEntity(id: string): Promise<Payment> {
    const payment = await this.createPaymentQuery()
      .where('payment.id = :id', { id })
      .getOne();

    if (payment === null) {
      throw new NotFoundException('Khong tim thay payment.');
    }

    return payment;
  }

  private createPaymentQuery(): SelectQueryBuilder<Payment> {
    return this.paymentsRepository
      .createQueryBuilder('payment')
      .leftJoinAndSelect('payment.createdByUser', 'createdByUser')
      .leftJoinAndSelect('payment.refundedByUser', 'refundedByUser');
  }

  private async getLockedBooking(
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

  private assertBookingCanBePaid(booking: Booking): void {
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
      new Date(booking.createdAt.getTime() + this.paymentTimeoutMilliseconds);

    if (
      booking.status === BookingStatus.PENDING_PAYMENT &&
      paymentExpiresAt.getTime() <= Date.now()
    ) {
      throw new ConflictException('Booking da het thoi gian thanh toan.');
    }
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

  private async failExpiredOnlinePaymentsForBooking(
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

  private optionalPaymentStatus(value: unknown): PaymentStatus | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    if (
      typeof value !== 'string' ||
      !Object.values(PaymentStatus).includes(value as PaymentStatus)
    ) {
      throw new BadRequestException('Trang thai payment khong hop le.');
    }

    return value as PaymentStatus;
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

  private toResponse(payment: Payment): PaymentResponse {
    return {
      id: payment.id,
      bookingId: payment.bookingId,
      amount: payment.amount,
      currency: payment.currency,
      method: payment.method,
      status: payment.status,
      gatewayName: payment.gatewayName,
      gatewayReference: payment.gatewayReference,
      gatewayTransactionId: payment.gatewayTransactionId,
      gatewayResponseCode: payment.gatewayResponseCode,
      gatewayTransactionStatus: payment.gatewayTransactionStatus,
      gatewayTransactionDate: payment.gatewayTransactionDate,
      refundRequestId: payment.refundRequestId,
      refundPreviousStatus: payment.refundPreviousStatus,
      refundGatewayTransactionId: payment.refundGatewayTransactionId,
      refundResponseCode: payment.refundResponseCode,
      refundTransactionStatus: payment.refundTransactionStatus,
      refundMessage: payment.refundMessage,
      refundReason: payment.refundReason,
      createdByUserId: payment.createdByUserId,
      refundedByUserId: payment.refundedByUserId,
      paidAt: payment.paidAt,
      refundedAt: payment.refundedAt,
      refundRequestedAt: payment.refundRequestedAt,
      refundLastQueriedAt: payment.refundLastQueriedAt,
      expiresAt: payment.expiresAt,
      createdByUser:
        payment.createdByUser === null
          ? null
          : {
              id: payment.createdByUser.id,
              fullName: payment.createdByUser.fullName,
            },
      refundedByUser:
        payment.refundedByUser === null
          ? null
          : {
              id: payment.refundedByUser.id,
              fullName: payment.refundedByUser.fullName,
            },
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    };
  }
}

function toVnPayAmount(amount: string): string {
  const match = /^([0-9]+)[.]([0-9]{2})$/.exec(amount);

  if (match === null) {
    throw new Error('Payment amount is invalid.');
  }

  return (BigInt(match[1]) * 100n + BigInt(match[2])).toString();
}

function createVnPayRequestId(prefix: 'Q' | 'R'): string {
  return `${prefix}${randomUUID().replaceAll('-', '').slice(0, 31)}`;
}

function isMatchingVnPayOperationAmount(
  paymentAmount: string,
  gatewayAmount: string | null,
): boolean {
  if (gatewayAmount === null) {
    return false;
  }

  const wholeAmount = paymentAmount.replace(/[.]00$/, '');

  return (
    gatewayAmount === wholeAmount ||
    gatewayAmount === paymentAmount ||
    gatewayAmount === toVnPayAmount(paymentAmount)
  );
}

function getErrorStack(error: unknown): string | undefined {
  return error instanceof Error ? error.stack : undefined;
}
