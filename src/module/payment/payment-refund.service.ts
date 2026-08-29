import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

import {
  type TransactionContext,
  TransactionRunner,
} from '../../common/application/transaction';
import { ErrorCode } from '../../common/error-codes';
import { AppHttpException } from '../../common/http/app-http-exception';
import {
  isValidIdempotencyKey,
  optionalNullableTrimmedString,
  requireTrimmedString,
} from '../../common/validation';
import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
} from '../audit/domain/audit-log';
import { TransactionalAuditLog } from '../audit/ports/transactional-audit-log';
import { BookingPaymentLifecycleService } from '../booking/booking-payment-lifecycle.service';
import { Booking } from '../booking/schema/booking.entity';
import {
  BookingPaymentStatus,
  BookingStatus,
} from '../booking/domain/booking-state';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { PaymentQueryService } from './payment-query.service';
import {
  PaymentRefundIdempotencyConflictError,
  PaymentRefundStore,
} from './ports/payment-refund.store';
import type { PaymentResponse } from './payment.types';
import { Payment } from './schema/payment.entity';
import {
  PaymentMethod,
  PaymentReviewReason,
  PaymentStatus,
} from './domain/payment-state';
import {
  toVnPayAmount,
  VnPayGatewayService,
  type VnPayTransactionOperationInput,
  type VnPayTransactionResult,
} from './vnpay-gateway.service';
import { PaymentRefundCapability } from './domain/payment-refund-capability';

export { PaymentRefundCapability };

@Injectable()
export class PaymentRefundService {
  private readonly logger = new Logger(PaymentRefundService.name);

  constructor(
    private readonly transactions: TransactionRunner,
    private readonly refunds: PaymentRefundStore,
    private readonly lifecycle: BookingPaymentLifecycleService,
    private readonly paymentQueryService: PaymentQueryService,
    private readonly vnPay: VnPayGatewayService,
    private readonly auditLog: TransactionalAuditLog,
  ) {}

  async refund(
    userId: string | undefined,
    paymentId: string,
    idempotencyKey: string | undefined,
    clientIp: string | undefined,
    body: RefundPaymentDto,
    requestId?: string,
  ): Promise<PaymentResponse> {
    const refundedByUserId = this.requireActorId(userId);
    this.validateId(paymentId, 'Payment id khong hop le.');
    const reason =
      optionalNullableTrimmedString(
        body.reason,
        'Ly do hoan tien khong hop le.',
        500,
      ) ?? 'Hoàn tiền theo yêu cầu.';
    const paymentSnapshot = await this.refunds.findPaymentSnapshot(paymentId);

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
        PaymentRefundCapability.STANDARD_REFUND,
        requestId,
      );
    }

    return this.refundManual(
      refundedByUserId,
      paymentSnapshot,
      reason,
      requestId,
    );
  }

  async resolveDuplicateCharge(
    userId: string | undefined,
    paymentId: string,
    idempotencyKey: string | undefined,
    clientIp: string | undefined,
    requestId?: string,
  ): Promise<PaymentResponse> {
    const refundedByUserId = this.requireActorId(userId);
    this.validateId(paymentId, 'Payment id khong hop le.');
    const paymentSnapshot = await this.refunds.findPaymentSnapshot(paymentId);

    if (paymentSnapshot === null) {
      throw new NotFoundException('Khong tim thay payment.');
    }

    if (paymentSnapshot.method !== PaymentMethod.VNPAY) {
      throw this.duplicateChargeResolutionNotAllowed(
        'Chi payment VNPay trung moi co the duoc xu ly theo capability nay.',
      );
    }

    return this.refundVnPay(
      refundedByUserId,
      paymentSnapshot,
      this.requireIdempotencyKey(idempotencyKey),
      clientIp,
      'Duplicate VNPay charge resolution.',
      PaymentRefundCapability.DUPLICATE_CHARGE_REFUND,
      requestId,
    );
  }

  async reconcileVnPayRefund(
    userId: string | undefined,
    paymentId: string,
    clientIp: string | undefined,
    requestId?: string,
  ): Promise<PaymentResponse> {
    const reconciledByUserId = this.requireActorId(userId);
    this.validateId(paymentId, 'Payment id khong hop le.');
    const payment = await this.refunds.findPaymentSnapshot(paymentId);

    if (payment === null) {
      throw new NotFoundException('Khong tim thay payment.');
    }

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

    const refund = payment.refund;
    if (
      refund !== null &&
      refund !== undefined &&
      refund.gatewayTransactionId !== null
    ) {
      operationInput.transactionId = refund.gatewayTransactionId;
    }
    let result: VnPayTransactionResult;

    try {
      result = await this.vnPay.lookupTransaction(operationInput);
    } catch (error) {
      await this.recordRefundQueryFailure(payment.id);
      this.logger.error(
        `operation=VNPAY_REFUND_RECONCILE paymentId=${payment.id} bookingId=${payment.bookingId} errorCode=GATEWAY_QUERY_FAILED requestId=${requestId ?? 'unknown'}`,
        getErrorStack(error),
      );
      throw new ServiceUnavailableException(
        'Khong the doi soat refund voi VNPay luc nay.',
      );
    }

    await this.applyVnPayReconciliation(
      payment.id,
      result,
      reconciledByUserId,
      requestId,
    );

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
    requestId?: string,
  ): Promise<PaymentResponse> {
    const paymentId = paymentSnapshot.id;

    await this.transactions.run(async (transaction) => {
      const booking = await this.getLockedBooking(
        transaction,
        paymentSnapshot.bookingId,
      );
      const payment = await this.refunds.lockPayment(transaction, paymentId);

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
        throw new AppHttpException(
          HttpStatus.CONFLICT,
          ErrorCode.PAYMENT_REFUND_NOT_ALLOWED,
          'Payment hien khong the hoan tien.',
        );
      }

      if (
        booking.status === BookingStatus.CHECKED_IN ||
        booking.status === BookingStatus.CHECKED_OUT ||
        booking.status === BookingStatus.CANCELLED
      ) {
        throw new AppHttpException(
          HttpStatus.CONFLICT,
          ErrorCode.PAYMENT_REFUND_NOT_ALLOWED,
          'Khong the hoan tien booking o trang thai hien tai.',
        );
      }

      const refund = await this.refunds.createRefund(transaction, {
        paymentId: payment.id,
        idempotencyKey: null,
        requestId: null,
        previousPaymentStatus: null,
        gatewayTransactionId: null,
        responseCode: null,
        transactionStatus: null,
        message: null,
        reason,
        refundedByUserId,
        requestedAt: null,
        refundedAt: null,
        lastQueriedAt: null,
      });
      payment.refund = refund;

      await this.lifecycle.completeRefund(
        transaction,
        booking,
        payment,
        refundedByUserId,
        requestId,
      );
    });

    return this.getManagementPayment(paymentId);
  }

  private async refundVnPay(
    refundedByUserId: string,
    paymentSnapshot: Payment,
    idempotencyKey: string,
    clientIp: string | undefined,
    reason: string,
    capability: PaymentRefundCapability,
    requestId?: string,
  ): Promise<PaymentResponse> {
    const preparation = await this.prepareVnPayRefund(
      refundedByUserId,
      paymentSnapshot,
      idempotencyKey,
      reason,
      capability,
      requestId,
    );

    if (preparation === 'REFUNDED') {
      return this.getManagementPayment(paymentSnapshot.id);
    }

    if (preparation === 'REJECTED_REPLAY') {
      throw new AppHttpException(
        HttpStatus.CONFLICT,
        ErrorCode.PAYMENT_REFUND_REJECTED,
        'Yeu cau hoan tien VNPay nay da bi tu choi.',
      );
    }

    if (preparation === 'PENDING_REPLAY') {
      return this.reconcileVnPayRefund(
        refundedByUserId,
        paymentSnapshot.id,
        clientIp,
        requestId,
      );
    }

    const pendingPayment = await this.refunds.findPaymentSnapshot(
      paymentSnapshot.id,
    );

    if (pendingPayment === null) {
      throw new NotFoundException('Khong tim thay payment.');
    }
    const operationInput = this.getVnPayOperationInput(
      pendingPayment,
      this.requireRefund(pendingPayment).requestId as string,
      clientIp,
      `Hoan tien booking ${pendingPayment.bookingId}: ${reason}`,
    );
    let result: VnPayTransactionResult;

    try {
      result = await this.vnPay.requestRefund({
        ...operationInput,
        createdBy: `user-${refundedByUserId}`,
      });
    } catch (error) {
      this.logger.error(
        `operation=VNPAY_REFUND_REQUEST paymentId=${pendingPayment.id} bookingId=${pendingPayment.bookingId} errorCode=${ErrorCode.PAYMENT_REFUND_OUTCOME_UNKNOWN} requestId=${requestId ?? 'unknown'}`,
        getErrorStack(error),
      );
      throw new AppHttpException(
        HttpStatus.SERVICE_UNAVAILABLE,
        ErrorCode.PAYMENT_REFUND_OUTCOME_UNKNOWN,
        'Chua xac dinh duoc ket qua hoan tien VNPay. Hay doi soat truoc khi thu lai.',
      );
    }

    const outcome = await this.applyVnPayRefundResult(
      pendingPayment.id,
      result,
      refundedByUserId,
      requestId,
    );

    if (outcome === 'SUCCESS') {
      return this.getManagementPayment(pendingPayment.id);
    }

    if (outcome === 'REJECTED') {
      this.logger.warn(
        `operation=VNPAY_REFUND_REQUEST paymentId=${pendingPayment.id} bookingId=${pendingPayment.bookingId} errorCode=${ErrorCode.PAYMENT_REFUND_REJECTED} requestId=${requestId ?? 'unknown'} gatewayResponseCode=${result.providerResponseCode}`,
      );
      throw new AppHttpException(
        HttpStatus.CONFLICT,
        ErrorCode.PAYMENT_REFUND_REJECTED,
        'VNPay tu choi yeu cau hoan tien.',
      );
    }

    if (this.isAcceptedVnPayRefund(paymentSnapshot, result)) {
      return this.getManagementPayment(pendingPayment.id);
    }

    throw new AppHttpException(
      HttpStatus.SERVICE_UNAVAILABLE,
      ErrorCode.PAYMENT_REFUND_OUTCOME_UNKNOWN,
      'Chua xac dinh duoc ket qua hoan tien VNPay. Hay thuc hien doi soat.',
    );
  }

  private async prepareVnPayRefund(
    refundedByUserId: string,
    paymentSnapshot: Payment,
    idempotencyKey: string,
    reason: string,
    capability: PaymentRefundCapability,
    requestId?: string,
  ): Promise<'NEW' | 'PENDING_REPLAY' | 'REJECTED_REPLAY' | 'REFUNDED'> {
    try {
      return await this.transactions.run(async (transaction) => {
        const booking = await this.getLockedBooking(
          transaction,
          paymentSnapshot.bookingId,
        );
        const payment = await this.refunds.lockPayment(
          transaction,
          paymentSnapshot.id,
        );

        if (payment === null) {
          throw new NotFoundException('Khong tim thay payment.');
        }

        if (capability === PaymentRefundCapability.DUPLICATE_CHARGE_REFUND) {
          await this.getLockedDuplicateChargeCanonicalPayment(
            transaction,
            booking,
            payment,
          );
        }

        const paymentUsingKey = await this.refunds.findByRefundIdempotencyKey(
          transaction,
          idempotencyKey,
        );

        if (
          paymentUsingKey !== null &&
          paymentUsingKey.paymentId !== payment.id
        ) {
          throw new AppHttpException(
            HttpStatus.CONFLICT,
            ErrorCode.PAYMENT_IDEMPOTENCY_KEY_CONFLICT,
            'Idempotency-Key da duoc su dung cho request khac.',
          );
        }

        if (payment.status === PaymentStatus.REFUNDED) {
          return 'REFUNDED';
        }

        if (payment.status === PaymentStatus.REFUND_PENDING) {
          if (payment.refund?.idempotencyKey !== idempotencyKey) {
            throw new ConflictException(
              'Payment dang co yeu cau hoan tien VNPay cho xu ly.',
            );
          }

          return 'PENDING_REPLAY';
        }

        if (payment.refund !== null && payment.refund !== undefined) {
          if (
            payment.refund.idempotencyKey === idempotencyKey &&
            payment.refund.responseCode !== null
          ) {
            return 'REJECTED_REPLAY';
          }

          throw new ConflictException(
            'Payment da co mot yeu cau hoan tien VNPay truoc do.',
          );
        }

        if (capability === PaymentRefundCapability.STANDARD_REFUND) {
          this.assertVnPayRefundAllowed(booking, payment);
        }
        const transactionDate = this.resolveGatewayTransactionDate(payment);

        const previousStatus = payment.status;

        const refund = await this.refunds.createRefund(transaction, {
          paymentId: payment.id,
          idempotencyKey,
          requestId: createVnPayRequestId('R'),
          previousPaymentStatus: previousStatus,
          gatewayTransactionId: null,
          responseCode: null,
          transactionStatus: null,
          message: null,
          reason,
          refundedByUserId,
          requestedAt: new Date(),
          refundedAt: null,
          lastQueriedAt: null,
        });
        payment.status = PaymentStatus.REFUND_PENDING;
        payment.gatewayTransactionDate = transactionDate;
        payment.refund = refund;

        await this.refunds.savePaymentState(transaction, payment);
        await this.auditLog.record(transaction, {
          actorType: AuditActorType.USER,
          actorId: refundedByUserId,
          action: AuditAction.REFUND_REQUESTED,
          entityType: AuditEntityType.PAYMENT,
          entityId: payment.id,
          requestId,
          metadata: this.getRefundAuditMetadata(booking, payment),
        });
        return 'NEW';
      });
    } catch (error) {
      if (error instanceof PaymentRefundIdempotencyConflictError) {
        throw new AppHttpException(
          HttpStatus.CONFLICT,
          ErrorCode.PAYMENT_IDEMPOTENCY_KEY_CONFLICT,
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
      if (
        booking.status !== BookingStatus.CANCELLED ||
        payment.reviewReason !== PaymentReviewReason.BOOKING_CANCELLED
      ) {
        throw new ConflictException(
          'Payment can review khong thuoc luong refund booking da huy.',
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
  ): VnPayTransactionOperationInput {
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
      const value = this.vnPay.resolveTransactionDate(
        payment.gatewayPaymentUrl,
      );

      if (value !== null) {
        return value;
      }
    }

    throw new ConflictException(
      'Payment VNPay thieu ngay giao dich goc de hoan tien.',
    );
  }

  private async applyVnPayRefundResult(
    paymentId: string,
    result: VnPayTransactionResult,
    actorId: string,
    requestId?: string,
  ): Promise<'SUCCESS' | 'REJECTED' | 'PENDING'> {
    return this.transactions.run(async (transaction) => {
      const paymentSnapshot = await this.refunds.findPayment(
        transaction,
        paymentId,
      );

      if (paymentSnapshot === null) {
        throw new NotFoundException('Khong tim thay payment.');
      }

      const booking = await this.getLockedBooking(
        transaction,
        paymentSnapshot.bookingId,
      );
      const payment = await this.refunds.lockPayment(transaction, paymentId);

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

      const refund = this.requireRefund(payment);

      if (!result.isVerified) {
        refund.message =
          'Phan hoi refund VNPay khong xac minh duoc; can doi soat.';
        await this.refunds.saveRefundState(transaction, refund);
        return 'PENDING';
      }

      this.assignRefundGatewayResult(refund, result);

      if (this.isSuccessfulVnPayRefund(payment, result)) {
        await this.lifecycle.completeRefund(
          transaction,
          booking,
          payment,
          actorId,
          requestId,
        );
        return 'SUCCESS';
      }

      if (this.isAmbiguousVnPayResult(result)) {
        await this.refunds.saveRefundState(transaction, refund);
        return 'PENDING';
      }

      payment.status =
        refund.previousPaymentStatus === PaymentStatus.REQUIRES_REVIEW
          ? PaymentStatus.REQUIRES_REVIEW
          : PaymentStatus.SUCCESS;
      await this.refunds.saveRefundState(transaction, refund);
      await this.refunds.savePaymentState(transaction, payment);
      return 'REJECTED';
    });
  }

  private async applyVnPayReconciliation(
    paymentId: string,
    result: VnPayTransactionResult,
    actorId: string,
    requestId?: string,
  ): Promise<void> {
    await this.transactions.run(async (transaction) => {
      const paymentSnapshot = await this.refunds.findPayment(
        transaction,
        paymentId,
      );

      if (paymentSnapshot === null) {
        throw new NotFoundException('Khong tim thay payment.');
      }

      const booking = await this.getLockedBooking(
        transaction,
        paymentSnapshot.bookingId,
      );
      const payment = await this.refunds.lockPayment(transaction, paymentId);

      if (payment === null || payment.status !== PaymentStatus.REFUND_PENDING) {
        return;
      }

      const refund = this.requireRefund(payment);
      refund.lastQueriedAt = new Date();

      if (!result.isVerified) {
        refund.message = 'Phan hoi doi soat VNPay khong xac minh duoc.';
        await this.refunds.saveRefundState(transaction, refund);
        return;
      }

      if (this.isSuccessfulVnPayRefund(payment, result)) {
        this.assignRefundGatewayResult(refund, result);
        await this.lifecycle.completeRefund(
          transaction,
          booking,
          payment,
          actorId,
          requestId,
        );
        return;
      }

      if (result.providerTransactionType === '02') {
        this.assignRefundGatewayResult(refund, result);
      }

      if (this.isAmbiguousVnPayResult(result)) {
        await this.refunds.saveRefundState(transaction, refund);
        return;
      }

      if (result.providerTransactionType === '02') {
        payment.status =
          refund.previousPaymentStatus === PaymentStatus.REQUIRES_REVIEW
            ? PaymentStatus.REQUIRES_REVIEW
            : PaymentStatus.SUCCESS;
      } else {
        refund.message =
          `QueryDr did not return a refund transaction: ${result.message}`.slice(
            0,
            255,
          );
      }

      await this.refunds.saveRefundState(transaction, refund);
      await this.refunds.savePaymentState(transaction, payment);
    });
  }

  private assignRefundGatewayResult(
    refund: NonNullable<Payment['refund']>,
    result: VnPayTransactionResult,
  ): void {
    refund.gatewayTransactionId = result.providerTransactionId;
    refund.responseCode = result.providerResponseCode;
    refund.transactionStatus = result.providerTransactionStatus;
    refund.message = result.message.slice(0, 255);
  }

  private isSuccessfulVnPayRefund(
    payment: Payment,
    result: VnPayTransactionResult,
  ): boolean {
    return (
      result.isVerified &&
      result.isSuccess &&
      result.providerResponseCode === '00' &&
      result.providerTransactionStatus === '00' &&
      result.providerTransactionType === '02' &&
      result.providerTransactionId !== null &&
      result.providerTransactionId.length > 0 &&
      isMatchingVnPayOperationAmount(payment.amount, result.gatewayAmount)
    );
  }

  private isAmbiguousVnPayResult(result: VnPayTransactionResult): boolean {
    return (
      !result.isVerified ||
      result.providerResponseCode === null ||
      result.providerResponseCode === '94' ||
      result.providerResponseCode === '98' ||
      result.providerResponseCode === '99' ||
      result.providerTransactionStatus === '05' ||
      result.providerTransactionStatus === '06' ||
      (result.isSuccess &&
        result.providerResponseCode === '00' &&
        result.providerTransactionStatus === '00' &&
        result.providerTransactionType === '02' &&
        (result.providerTransactionId === null ||
          result.providerTransactionId.length === 0))
    );
  }

  private isAcceptedVnPayRefund(
    payment: Payment,
    result: VnPayTransactionResult,
  ): boolean {
    return (
      result.isVerified &&
      result.isSuccess &&
      result.providerResponseCode === '00' &&
      (result.providerTransactionStatus === '05' ||
        result.providerTransactionStatus === '06') &&
      result.providerTransactionType === '02' &&
      isMatchingVnPayOperationAmount(payment.amount, result.gatewayAmount)
    );
  }

  private async recordRefundQueryFailure(paymentId: string): Promise<void> {
    await this.refunds.recordRefundQueryFailure(paymentId, new Date());
  }

  private async getManagementPayment(id: string): Promise<PaymentResponse> {
    return this.paymentQueryService.getManagementPayment(id);
  }

  private async getLockedBooking(
    context: TransactionContext,
    id: string,
  ): Promise<Booking> {
    const booking = await this.refunds.lockBooking(context, id);

    if (booking === null) {
      throw new NotFoundException('Khong tim thay booking.');
    }

    return booking;
  }

  private async getLockedDuplicateChargeCanonicalPayment(
    context: TransactionContext,
    booking: Booking,
    payment: Payment,
  ): Promise<Payment> {
    const isEligibleTargetState =
      payment.status === PaymentStatus.REQUIRES_REVIEW ||
      ((payment.status === PaymentStatus.REFUND_PENDING ||
        payment.status === PaymentStatus.REFUNDED) &&
        payment.refund?.previousPaymentStatus ===
          PaymentStatus.REQUIRES_REVIEW);

    if (
      !isEligibleTargetState ||
      payment.method !== PaymentMethod.VNPAY ||
      payment.reviewReason !== PaymentReviewReason.ANOTHER_SUCCESSFUL_PAYMENT ||
      payment.reviewCanonicalPaymentId === null ||
      payment.reviewCanonicalPaymentId === payment.id ||
      payment.gatewayReference === null ||
      payment.gatewayTransactionId === null
    ) {
      throw this.duplicateChargeResolutionNotAllowed(
        'Payment khong phai giao dich VNPay trung can xu ly.',
      );
    }

    const canonicalPayment = await this.refunds.lockCanonicalSuccessfulPayment(
      context,
      payment.reviewCanonicalPaymentId,
      booking.id,
    );

    if (canonicalPayment === null) {
      throw this.duplicateChargeResolutionNotAllowed(
        'Khong con payment SUCCESS chinh cho booking nay.',
      );
    }

    return canonicalPayment;
  }

  private isDuplicateChargeRefund(payment: Payment): boolean {
    return (
      payment.refund?.previousPaymentStatus === PaymentStatus.REQUIRES_REVIEW &&
      payment.reviewReason === PaymentReviewReason.ANOTHER_SUCCESSFUL_PAYMENT &&
      payment.reviewCanonicalPaymentId !== null &&
      payment.reviewCanonicalPaymentId !== payment.id
    );
  }

  private getRefundAuditMetadata(
    booking: Booking,
    payment: Payment,
  ): Record<string, string> {
    if (this.isDuplicateChargeRefund(payment)) {
      return {
        bookingId: booking.id,
        canonicalPaymentId: payment.reviewCanonicalPaymentId as string,
        duplicatePaymentId: payment.id,
        reason: PaymentReviewReason.ANOTHER_SUCCESSFUL_PAYMENT,
        refundRequestId: payment.refund?.requestId as string,
        capability: PaymentRefundCapability.DUPLICATE_CHARGE_REFUND,
        method: payment.method,
      };
    }

    return {
      bookingId: booking.id,
      method: payment.method,
    };
  }

  private duplicateChargeResolutionNotAllowed(
    message: string,
  ): AppHttpException {
    return new AppHttpException(
      HttpStatus.CONFLICT,
      ErrorCode.PAYMENT_REFUND_NOT_ALLOWED,
      message,
    );
  }

  private requireRefund(payment: Payment): NonNullable<Payment['refund']> {
    if (payment.refund === null || payment.refund === undefined) {
      throw new ConflictException(
        'Payment dang thieu ban ghi refund de tiep tuc xu ly.',
      );
    }

    return payment.refund;
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
