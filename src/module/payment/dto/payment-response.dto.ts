import { ApiProperty } from '@nestjs/swagger';

import { PaginationDto } from '../../../openapi/response-envelope.dto';
import {
  PaymentMethod,
  PaymentReviewReason,
  PaymentStatus,
} from '../domain/payment-state';

const nullablePaymentStatuses = [
  ...Object.values(PaymentStatus),
  null,
] as unknown as string[];

export class PaymentUserDto {
  @ApiProperty({ example: '1' })
  id!: string;

  @ApiProperty({ example: 'Admin One' })
  fullName!: string;
}

export class PaymentManagementMetaDto {
  @ApiProperty({ type: PaginationDto })
  pagination!: PaginationDto;

  @ApiProperty({
    description: 'Number of VNPay refunds still pending more than seven days.',
    example: 2,
    minimum: 0,
  })
  staleRefundCount!: number;
}

export class CustomerPaymentDto {
  @ApiProperty({ example: '1' })
  id!: string;

  @ApiProperty({ example: '1' })
  bookingId!: string;

  @ApiProperty({ example: '3000000.00' })
  amount!: string;

  @ApiProperty({ enum: ['VND'], example: 'VND' })
  currency!: 'VND';

  @ApiProperty({ enum: PaymentMethod, enumName: 'PaymentMethod' })
  method!: PaymentMethod;

  @ApiProperty({ enum: PaymentStatus, enumName: 'PaymentStatus' })
  status!: PaymentStatus;

  @ApiProperty({
    description: 'Safe merchant payment reference shown on customer receipts.',
    nullable: true,
    type: String,
  })
  gatewayReference!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: Date })
  paidAt!: Date | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: Date })
  refundedAt!: Date | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: Date })
  expiresAt!: Date | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class PaymentDto {
  @ApiProperty({ example: '1' })
  id!: string;

  @ApiProperty({ example: '1' })
  bookingId!: string;

  @ApiProperty({ example: '3000000.00' })
  amount!: string;

  @ApiProperty({ enum: ['VND'], example: 'VND' })
  currency!: 'VND';

  @ApiProperty({ enum: PaymentMethod, enumName: 'PaymentMethod' })
  method!: PaymentMethod;

  @ApiProperty({ enum: PaymentStatus, enumName: 'PaymentStatus' })
  status!: PaymentStatus;

  @ApiProperty({
    enum: PaymentReviewReason,
    enumName: 'PaymentReviewReason',
    nullable: true,
  })
  reviewReason!: PaymentReviewReason | null;

  @ApiProperty({ example: '1', nullable: true, type: String })
  reviewCanonicalPaymentId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  gatewayName!: string | null;

  @ApiProperty({ nullable: true, type: String })
  gatewayReference!: string | null;

  @ApiProperty({ nullable: true, type: String })
  gatewayTransactionId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  gatewayResponseCode!: string | null;

  @ApiProperty({ nullable: true, type: String })
  gatewayTransactionStatus!: string | null;

  @ApiProperty({ nullable: true, type: String })
  gatewayTransactionDate!: string | null;

  @ApiProperty({ nullable: true, type: String })
  refundRequestId!: string | null;

  @ApiProperty({ enum: nullablePaymentStatuses, nullable: true })
  refundPreviousStatus!: PaymentStatus | null;

  @ApiProperty({ nullable: true, type: String })
  refundGatewayTransactionId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  refundResponseCode!: string | null;

  @ApiProperty({ nullable: true, type: String })
  refundTransactionStatus!: string | null;

  @ApiProperty({ nullable: true, type: String })
  refundMessage!: string | null;

  @ApiProperty({ nullable: true, type: String })
  refundReason!: string | null;

  @ApiProperty({ example: '1', nullable: true, type: String })
  createdByUserId!: string | null;

  @ApiProperty({ example: '1', nullable: true, type: String })
  refundedByUserId!: string | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: Date })
  paidAt!: Date | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: Date })
  refundedAt!: Date | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: Date })
  refundRequestedAt!: Date | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: Date })
  refundLastQueriedAt!: Date | null;

  @ApiProperty({ format: 'date-time', nullable: true, type: Date })
  expiresAt!: Date | null;

  @ApiProperty({ type: PaymentUserDto, nullable: true })
  createdByUser!: PaymentUserDto | null;

  @ApiProperty({ type: PaymentUserDto, nullable: true })
  refundedByUser!: PaymentUserDto | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: Date;
}

export class OnlinePaymentDto {
  @ApiProperty({ type: CustomerPaymentDto })
  payment!: CustomerPaymentDto;

  @ApiProperty({ format: 'uri' })
  paymentUrl!: string;

  @ApiProperty({ format: 'date-time' })
  expiresAt!: Date;
}

export class VnPayReturnDto {
  @ApiProperty()
  validSignature!: boolean;

  @ApiProperty({ nullable: true, type: String })
  paymentId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  bookingId!: string | null;

  @ApiProperty({ enum: nullablePaymentStatuses, nullable: true })
  paymentStatus!: PaymentStatus | null;

  @ApiProperty({ nullable: true, type: String })
  responseCode!: string | null;

  @ApiProperty({ nullable: true, type: String })
  transactionStatus!: string | null;
}

export class VnPayIpnDto {
  @ApiProperty({ enum: ['00', '01', '02', '04', '97', '99'] })
  RspCode!: '00' | '01' | '02' | '04' | '97' | '99';

  @ApiProperty()
  Message!: string;
}
