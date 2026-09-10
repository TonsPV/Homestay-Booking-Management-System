import { ConflictException, HttpStatus } from '@nestjs/common';

import { ErrorCode } from '../../../common/error-codes';
import { AppHttpException } from '../../../common/http/app-http-exception';
import {
  BookingPaymentStatus,
  BookingStatus,
} from '../../booking/domain/booking-state';
import type { Booking } from '../../booking/schema/booking.entity';
import { toVnPayAmount } from '../vnpay-gateway.service';
import type { VnPayTransactionResult } from '../vnpay-gateway.service';
import type { Payment } from '../schema/payment.entity';
import { PaymentReviewReason, PaymentStatus } from './payment-state';

export function assertManualRefundAllowed(
  booking: Booking,
  payment: Payment,
): void {
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
}

export function assertVnPayRefundAllowed(
  booking: Booking,
  payment: Payment,
): void {
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

export function getMaximumRefundAmount(payment: Payment): string {
  return payment.amount;
}

export function isSuccessfulVnPayRefund(
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
    matchesVnPayAmount(getMaximumRefundAmount(payment), result.gatewayAmount)
  );
}

export function isAmbiguousVnPayResult(
  result: VnPayTransactionResult,
): boolean {
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

export function isAcceptedVnPayRefund(
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
    matchesVnPayAmount(getMaximumRefundAmount(payment), result.gatewayAmount)
  );
}

function matchesVnPayAmount(
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
