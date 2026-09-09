import { ConflictException, HttpStatus } from '@nestjs/common';

import { ErrorCode } from '../../../../src/common/error-codes';
import { AppHttpException } from '../../../../src/common/http/app-http-exception';
import {
  BookingPaymentStatus,
  BookingStatus,
} from '../../../../src/module/booking/domain/booking-state';
import type { Booking } from '../../../../src/module/booking/schema/booking.entity';
import {
  assertManualRefundAllowed,
  assertVnPayRefundAllowed,
  getMaximumRefundAmount,
  isAcceptedVnPayRefund,
  isAmbiguousVnPayResult,
  isSuccessfulVnPayRefund,
} from '../../../../src/module/payment/domain/payment-refund.policy';
import {
  PaymentReviewReason,
  PaymentStatus,
} from '../../../../src/module/payment/domain/payment-state';
import type { Payment } from '../../../../src/module/payment/schema/payment.entity';
import type { VnPayTransactionResult } from '../../../../src/module/payment/vnpay-gateway.service';

describe('payment refund policy', () => {
  it('allows an eligible manual refund and preserves its maximum amount', () => {
    const booking = bookingFixture();
    const payment = paymentFixture();

    expect(() => assertManualRefundAllowed(booking, payment)).not.toThrow();
    expect(getMaximumRefundAmount(payment)).toBe('2000000.00');
  });

  it('keeps the manual refund error contract for an ineligible payment', () => {
    const booking = bookingFixture({
      paymentStatus: BookingPaymentStatus.UNPAID,
    });

    expectPolicyError(
      () => assertManualRefundAllowed(booking, paymentFixture()),
      AppHttpException,
      HttpStatus.CONFLICT,
      ErrorCode.PAYMENT_REFUND_NOT_ALLOWED,
      'Payment hien khong the hoan tien.',
    );
  });

  it('allows the cancelled-booking VNPay review path', () => {
    const booking = bookingFixture({ status: BookingStatus.CANCELLED });
    const payment = paymentFixture({
      status: PaymentStatus.REQUIRES_REVIEW,
      reviewReason: PaymentReviewReason.BOOKING_CANCELLED,
    });

    expect(() => assertVnPayRefundAllowed(booking, payment)).not.toThrow();
  });

  it('keeps the missing VNPay transaction error contract', () => {
    const payment = paymentFixture({ gatewayReference: null });

    expectPolicyError(
      () => assertVnPayRefundAllowed(bookingFixture(), payment),
      ConflictException,
      HttpStatus.CONFLICT,
      undefined,
      'Payment VNPay thieu thong tin giao dich de hoan tien.',
    );
  });

  it('classifies successful, accepted and ambiguous VNPay outcomes', () => {
    const payment = paymentFixture();
    const success = resultFixture();
    const accepted = resultFixture({ providerTransactionStatus: '05' });
    const ambiguous = resultFixture({ providerResponseCode: '99' });

    expect(isSuccessfulVnPayRefund(payment, success)).toBe(true);
    expect(isAcceptedVnPayRefund(payment, accepted)).toBe(true);
    expect(isAmbiguousVnPayResult(ambiguous)).toBe(true);
    expect(
      isSuccessfulVnPayRefund(payment, {
        ...success,
        gatewayAmount: '1000000',
      }),
    ).toBe(false);
  });
});

function expectPolicyError(
  work: () => void,
  exceptionType: typeof AppHttpException | typeof ConflictException,
  status: HttpStatus,
  errorCode: string | undefined,
  message: string,
): void {
  try {
    work();
    throw new Error('Expected refund policy to throw.');
  } catch (error) {
    expect(error).toBeInstanceOf(exceptionType);
    expect(error).toMatchObject({ status });
    expect((error as ConflictException).message).toBe(message);
    if (errorCode !== undefined) {
      expect((error as AppHttpException).getResponse()).toMatchObject({
        errorCode,
      });
    }
  }
}

function bookingFixture(overrides: Partial<Booking> = {}): Booking {
  return {
    status: BookingStatus.CONFIRMED,
    paymentStatus: BookingPaymentStatus.PAID,
    ...overrides,
  } as Booking;
}

function paymentFixture(overrides: Partial<Payment> = {}): Payment {
  return {
    id: '500',
    bookingId: '100',
    amount: '2000000.00',
    status: PaymentStatus.SUCCESS,
    reviewReason: null,
    gatewayReference: 'BK100',
    gatewayTransactionId: '123456',
    ...overrides,
  } as Payment;
}

function resultFixture(
  overrides: Partial<VnPayTransactionResult> = {},
): VnPayTransactionResult {
  return {
    isVerified: true,
    isSuccess: true,
    providerResponseCode: '00',
    providerTransactionStatus: '00',
    providerTransactionId: '654321',
    providerTransactionType: '02',
    gatewayAmount: '2000000',
    responseId: 'response-1',
    message: 'Success',
    ...overrides,
  };
}
