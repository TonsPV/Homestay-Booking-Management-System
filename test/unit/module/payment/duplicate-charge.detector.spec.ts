import { PaymentRefundCapability } from '../../../../src/module/payment/domain/payment-refund-capability';
import { detectDuplicateChargeRefund } from '../../../../src/module/payment/domain/duplicate-charge.detector';
import {
  PaymentMethod,
  PaymentReviewReason,
  PaymentStatus,
} from '../../../../src/module/payment/domain/payment-state';
import type { Payment } from '../../../../src/module/payment/schema/payment.entity';

describe('duplicate charge detector', () => {
  it('returns eligibility and audit metadata for a duplicate VNPay charge', () => {
    const assessment = detectDuplicateChargeRefund(paymentFixture(), '100');

    expect(assessment).toEqual({
      isDuplicateCharge: true,
      isEligibleForResolution: true,
      canonicalPaymentId: '501',
      metadata: {
        bookingId: '100',
        canonicalPaymentId: '501',
        duplicatePaymentId: '500',
        reason: PaymentReviewReason.ANOTHER_SUCCESSFUL_PAYMENT,
        refundRequestId: 'R1',
        capability: PaymentRefundCapability.DUPLICATE_CHARGE_REFUND,
        method: PaymentMethod.VNPAY,
      },
    });
  });

  it('accepts a replay state only when it originated from review', () => {
    const replay = paymentFixture({ status: PaymentStatus.REFUND_PENDING });
    const unrelated = paymentFixture({
      status: PaymentStatus.REFUND_PENDING,
      refund: {
        previousPaymentStatus: PaymentStatus.SUCCESS,
        requestId: 'R1',
      } as NonNullable<Payment['refund']>,
    });

    expect(
      detectDuplicateChargeRefund(replay, '100').isEligibleForResolution,
    ).toBe(true);
    expect(
      detectDuplicateChargeRefund(unrelated, '100').isEligibleForResolution,
    ).toBe(false);
  });

  it('rejects resolution when required gateway evidence is missing', () => {
    const payment = paymentFixture({ gatewayTransactionId: null });
    const assessment = detectDuplicateChargeRefund(payment, '100');

    expect(assessment.isDuplicateCharge).toBe(true);
    expect(assessment.isEligibleForResolution).toBe(false);
  });
});

function paymentFixture(overrides: Partial<Payment> = {}): Payment {
  return {
    id: '500',
    method: PaymentMethod.VNPAY,
    status: PaymentStatus.REQUIRES_REVIEW,
    reviewReason: PaymentReviewReason.ANOTHER_SUCCESSFUL_PAYMENT,
    reviewCanonicalPaymentId: '501',
    gatewayReference: 'BK100',
    gatewayTransactionId: '123456',
    refund: {
      previousPaymentStatus: PaymentStatus.REQUIRES_REVIEW,
      requestId: 'R1',
    } as NonNullable<Payment['refund']>,
    ...overrides,
  } as Payment;
}
