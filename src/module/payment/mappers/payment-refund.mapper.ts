import { ConflictException } from '@nestjs/common';

import type { Booking } from '../../booking/schema/booking.entity';
import { detectDuplicateChargeRefund } from '../domain/duplicate-charge.detector';
import type { Payment } from '../schema/payment.entity';
import type {
  VnPayOperationInput,
  VnPayTransactionResult,
} from '../vnpay-gateway.service';

interface BuildVnPayRefundInput {
  payment: Payment;
  resolveTransactionDate: () => string;
  requestId: string;
  orderInfo: string;
  clientIp: string | undefined;
  createdAt: Date;
}

export function buildVnPayRefundInput(
  input: BuildVnPayRefundInput,
): VnPayOperationInput {
  const { payment } = input;

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
    transactionDate: input.resolveTransactionDate(),
    requestId: input.requestId,
    orderInfo: input.orderInfo,
    ipAddress: input.clientIp,
    createdAt: input.createdAt,
  };
}

export function mapRefundGatewayResult(
  result: VnPayTransactionResult,
): Pick<
  NonNullable<Payment['refund']>,
  'gatewayTransactionId' | 'responseCode' | 'transactionStatus' | 'message'
> {
  return {
    gatewayTransactionId: result.providerTransactionId,
    responseCode: result.providerResponseCode,
    transactionStatus: result.providerTransactionStatus,
    message: result.message.slice(0, 255),
  };
}

export function buildRefundAuditMetadata(
  booking: Booking,
  payment: Payment,
): Record<string, string> {
  const duplicateCharge = detectDuplicateChargeRefund(payment, booking.id);

  return (
    duplicateCharge.metadata ?? {
      bookingId: booking.id,
      method: payment.method,
    }
  );
}
