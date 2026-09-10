import type { Payment } from '../schema/payment.entity';
import { PaymentRefundCapability } from './payment-refund-capability';
import {
  PaymentMethod,
  PaymentReviewReason,
  PaymentStatus,
} from './payment-state';

export interface DuplicateChargeAssessment {
  isDuplicateCharge: boolean;
  isEligibleForResolution: boolean;
  canonicalPaymentId: string | null;
  metadata: Record<string, string> | null;
}

export function detectDuplicateChargeRefund(
  payment: Payment,
  bookingId: string,
): DuplicateChargeAssessment {
  const canonicalPaymentId = payment.reviewCanonicalPaymentId;
  const isDuplicateCharge =
    payment.refund?.previousPaymentStatus === PaymentStatus.REQUIRES_REVIEW &&
    payment.reviewReason === PaymentReviewReason.ANOTHER_SUCCESSFUL_PAYMENT &&
    canonicalPaymentId !== null &&
    canonicalPaymentId !== payment.id;
  const isEligibleState =
    payment.status === PaymentStatus.REQUIRES_REVIEW ||
    ((payment.status === PaymentStatus.REFUND_PENDING ||
      payment.status === PaymentStatus.REFUNDED) &&
      payment.refund?.previousPaymentStatus === PaymentStatus.REQUIRES_REVIEW);
  const isEligibleForResolution =
    isEligibleState &&
    payment.method === PaymentMethod.VNPAY &&
    payment.reviewReason === PaymentReviewReason.ANOTHER_SUCCESSFUL_PAYMENT &&
    canonicalPaymentId !== null &&
    canonicalPaymentId !== payment.id &&
    payment.gatewayReference !== null &&
    payment.gatewayTransactionId !== null;

  return {
    isDuplicateCharge,
    isEligibleForResolution,
    canonicalPaymentId,
    metadata: isDuplicateCharge
      ? {
          bookingId,
          canonicalPaymentId,
          duplicatePaymentId: payment.id,
          reason: PaymentReviewReason.ANOTHER_SUCCESSFUL_PAYMENT,
          refundRequestId: payment.refund?.requestId as string,
          capability: PaymentRefundCapability.DUPLICATE_CHARGE_REFUND,
          method: payment.method,
        }
      : null,
  };
}
