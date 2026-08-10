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
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, type EntityManager, type Repository } from 'typeorm';

import { getMysqlDuplicateKey } from '../../common/database';
import { AppHttpException, ErrorCode } from '../../common/http';
import {
  optionalNullableTrimmedString,
  requireTrimmedString,
} from '../../common/validation';
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
import { RoomCalendar } from '../booking/schema/room-calendar.entity';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { PaymentQueryService } from './payment-query.service';
import type { PaymentResponse } from './payment.types';
import {
  Payment,
  PaymentMethod,
  PaymentReviewReason,
  PaymentStatus,
} from './schema/payment.entity';
import {
  VnPayGatewayService,
  type VnPayGatewayOperationResult,
} from './vnpay-gateway.service';

export enum PaymentRefundCapability {
  STANDARD_REFUND = 'STANDARD_REFUND',
  DUPLICATE_CHARGE_REFUND = 'DUPLICATE_CHARGE_REFUND',
}

@Injectable()
export class PaymentRefundService {
  private readonly logger = new Logger(PaymentRefundService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Payment)
    private readonly paymentsRepository: Repository<Payment>,
    private readonly paymentQueryService: PaymentQueryService,
    private readonly vnPayGatewayService: VnPayGatewayService,
    private readonly auditLogService: AuditLogService,
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
    const paymentSnapshot = await this.paymentsRepository.findOneBy({
      id: paymentId,
    });

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

      const now = new Date();
      const bookingFromStatus = booking.status;
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
      await this.auditLogService.record(manager, {
        actorType: AuditActorType.USER,
        actorId: refundedByUserId,
        action: AuditAction.REFUND_COMPLETED,
        entityType: AuditEntityType.PAYMENT,
        entityId: payment.id,
        requestId,
        metadata: {
          bookingId: booking.id,
          method: payment.method,
        },
      });
      await this.auditLogService.record(manager, {
        actorType: AuditActorType.USER,
        actorId: refundedByUserId,
        action: AuditAction.BOOKING_CANCELLED,
        entityType: AuditEntityType.BOOKING,
        entityId: booking.id,
        requestId,
        metadata: {
          fromStatus: bookingFromStatus,
          toStatus: booking.status,
          paymentId: payment.id,
        },
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
        `operation=VNPAY_REFUND_REQUEST paymentId=${pendingPayment.id} bookingId=${pendingPayment.bookingId} errorCode=${ErrorCode.PAYMENT_REFUND_REJECTED} requestId=${requestId ?? 'unknown'} gatewayResponseCode=${result.responseCode}`,
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

        if (capability === PaymentRefundCapability.DUPLICATE_CHARGE_REFUND) {
          await this.getLockedDuplicateChargeCanonicalPayment(
            manager,
            booking,
            payment,
          );
        }

        const paymentUsingKey = await paymentsRepository.findOneBy({
          refundIdempotencyKey: idempotencyKey,
        });

        if (paymentUsingKey !== null && paymentUsingKey.id !== payment.id) {
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

        if (capability === PaymentRefundCapability.STANDARD_REFUND) {
          this.assertVnPayRefundAllowed(booking, payment);
        }
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
        await this.auditLogService.record(manager, {
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
      const duplicateKey = getMysqlDuplicateKey(error);

      if (
        duplicateKey !== undefined &&
        duplicateKey.includes('payments_refund_idempotency')
      ) {
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
    actorId: string,
    requestId?: string,
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

      if (!result.isVerified) {
        payment.refundMessage =
          'Phan hoi refund VNPay khong xac minh duoc; can doi soat.';
        await paymentsRepository.save(payment);
        return 'PENDING';
      }

      this.assignRefundGatewayResult(payment, result);

      if (this.isSuccessfulVnPayRefund(payment, result)) {
        await this.completeRefund(
          manager,
          booking,
          payment,
          actorId,
          requestId,
        );
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
    actorId: string,
    requestId?: string,
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

      if (!result.isVerified) {
        payment.refundMessage = 'Phan hoi doi soat VNPay khong xac minh duoc.';
        await manager.getRepository(Payment).save(payment);
        return;
      }

      if (this.isSuccessfulVnPayRefund(payment, result)) {
        this.assignRefundGatewayResult(payment, result);
        await this.completeRefund(
          manager,
          booking,
          payment,
          actorId,
          requestId,
        );
        return;
      }

      if (result.transactionType === '02') {
        this.assignRefundGatewayResult(payment, result);
      }

      if (this.isAmbiguousVnPayResult(result)) {
        await manager.getRepository(Payment).save(payment);
        return;
      }

      if (result.transactionType === '02') {
        payment.status =
          payment.refundPreviousStatus === PaymentStatus.REQUIRES_REVIEW
            ? PaymentStatus.REQUIRES_REVIEW
            : PaymentStatus.SUCCESS;
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
      result.transactionId !== null &&
      result.transactionId.length > 0 &&
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
      result.transactionStatus === '06' ||
      (result.isSuccess &&
        result.responseCode === '00' &&
        result.transactionStatus === '00' &&
        result.transactionType === '02' &&
        (result.transactionId === null || result.transactionId.length === 0))
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
    actorId: string,
    requestId?: string,
  ): Promise<void> {
    const now = new Date();

    if (this.isDuplicateChargeRefund(payment)) {
      payment.status = PaymentStatus.REFUNDED;
      payment.refundedAt = now;
      await manager.getRepository(Payment).save(payment);
      await this.auditLogService.record(manager, {
        actorType: AuditActorType.USER,
        actorId,
        action: AuditAction.REFUND_COMPLETED,
        entityType: AuditEntityType.PAYMENT,
        entityId: payment.id,
        requestId,
        metadata: this.getRefundAuditMetadata(booking, payment),
      });
      return;
    }

    const bookingFromStatus = booking.status;

    payment.status = PaymentStatus.REFUNDED;
    payment.refundedAt = now;
    booking.paymentStatus = BookingPaymentStatus.REFUNDED;
    booking.paymentExpiresAt = null;

    if (booking.status !== BookingStatus.CANCELLED) {
      booking.status = BookingStatus.CANCELLED;
      booking.cancelledAt = now;
      booking.cancellationReason =
        payment.refundReason ?? 'Hoàn tiền theo yêu cầu.';
    }

    await manager.getRepository(Payment).save(payment);
    await manager.getRepository(Booking).save(booking);
    await manager.getRepository(RoomCalendar).delete({
      bookingId: booking.id,
    });
    await this.auditLogService.record(manager, {
      actorType: AuditActorType.USER,
      actorId,
      action: AuditAction.REFUND_COMPLETED,
      entityType: AuditEntityType.PAYMENT,
      entityId: payment.id,
      requestId,
      metadata: this.getRefundAuditMetadata(booking, payment),
    });
    if (bookingFromStatus !== booking.status) {
      await this.auditLogService.record(manager, {
        actorType: AuditActorType.USER,
        actorId,
        action: AuditAction.BOOKING_CANCELLED,
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

  private async getManagementPayment(id: string): Promise<PaymentResponse> {
    return this.paymentQueryService.getManagementPayment(id);
  }

  private async getPaymentEntity(id: string): Promise<Payment> {
    return this.paymentQueryService.getPaymentEntity(id);
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

  private async getLockedDuplicateChargeCanonicalPayment(
    manager: EntityManager,
    booking: Booking,
    payment: Payment,
  ): Promise<Payment> {
    const isEligibleTargetState =
      payment.status === PaymentStatus.REQUIRES_REVIEW ||
      ((payment.status === PaymentStatus.REFUND_PENDING ||
        payment.status === PaymentStatus.REFUNDED) &&
        payment.refundPreviousStatus === PaymentStatus.REQUIRES_REVIEW);

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

    const canonicalPayment = await manager
      .getRepository(Payment)
      .createQueryBuilder('canonicalPayment')
      .setLock('pessimistic_write')
      .where('canonicalPayment.id = :canonicalPaymentId', {
        canonicalPaymentId: payment.reviewCanonicalPaymentId,
      })
      .andWhere('canonicalPayment.bookingId = :bookingId', {
        bookingId: booking.id,
      })
      .andWhere('canonicalPayment.status = :status', {
        status: PaymentStatus.SUCCESS,
      })
      .getOne();

    if (canonicalPayment === null) {
      throw this.duplicateChargeResolutionNotAllowed(
        'Khong con payment SUCCESS chinh cho booking nay.',
      );
    }

    return canonicalPayment;
  }

  private isDuplicateChargeRefund(payment: Payment): boolean {
    return (
      payment.refundPreviousStatus === PaymentStatus.REQUIRES_REVIEW &&
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
        refundRequestId: payment.refundRequestId as string,
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
