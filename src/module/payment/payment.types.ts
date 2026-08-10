import {
  PaymentMethod,
  PaymentReviewReason,
  PaymentStatus,
} from './schema/payment.entity';

export interface PaymentResponse {
  id: string;
  bookingId: string;
  amount: string;
  currency: 'VND';
  method: PaymentMethod;
  status: PaymentStatus;
  reviewReason: PaymentReviewReason | null;
  reviewCanonicalPaymentId: string | null;
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

export interface CustomerPaymentResponse {
  id: string;
  bookingId: string;
  amount: string;
  currency: 'VND';
  method: PaymentMethod;
  status: PaymentStatus;
  gatewayReference: string | null;
  paidAt: Date | null;
  refundedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface OnlinePaymentResponse {
  payment: CustomerPaymentResponse;
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
