import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Booking } from '../../booking/schema/booking.entity';
import { User } from '../../user/schema/user.entity';

export enum PaymentMethod {
  CASH = 'CASH',
  BANK_TRANSFER = 'BANK_TRANSFER',
  VNPAY = 'VNPAY',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  SUCCESS = 'SUCCESS',
  FAILED = 'FAILED',
  REQUIRES_REVIEW = 'REQUIRES_REVIEW',
  REFUND_PENDING = 'REFUND_PENDING',
  REFUNDED = 'REFUNDED',
}

@Entity('payments')
@Index('uq_payments_gateway_transaction', ['gatewayTransactionId'], {
  unique: true,
})
@Index('uq_payments_gateway_reference', ['gatewayReference'], {
  unique: true,
})
@Index('uq_payments_idempotency', ['idempotencyKey'], { unique: true })
@Index('uq_payments_refund_idempotency', ['refundIdempotencyKey'], {
  unique: true,
})
@Index('uq_payments_refund_request', ['refundRequestId'], { unique: true })
@Index('idx_payments_booking', ['bookingId'])
@Index('idx_payments_status', ['status'])
@Index('idx_payments_created_by_user', ['createdByUserId'])
@Index('idx_payments_refunded_by_user', ['refundedByUserId'])
@Index('idx_payments_expires_at', ['expiresAt'])
@Check('chk_payments_amount', 'amount > 0')
@Check('chk_payments_currency', "currency = 'VND'")
export class Payment {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'booking_id', type: 'bigint' })
  bookingId: string;

  @ManyToOne(() => Booking, { nullable: false })
  @JoinColumn({
    name: 'booking_id',
    foreignKeyConstraintName: 'payments_ibfk_1',
  })
  booking: Booking;

  @Column({ type: 'decimal', precision: 12, scale: 2 })
  amount: string;

  @Column({ type: 'char', length: 3, default: 'VND' })
  currency: 'VND';

  @Column({ type: 'varchar', length: 30 })
  method: PaymentMethod;

  @Column({
    type: 'enum',
    enum: PaymentStatus,
    default: PaymentStatus.PENDING,
  })
  status: PaymentStatus;

  @Column({
    name: 'gateway_name',
    type: 'varchar',
    length: 80,
    nullable: true,
  })
  gatewayName: string | null;

  @Column({
    name: 'gateway_reference',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  gatewayReference: string | null;

  @Column({
    name: 'gateway_transaction_id',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  gatewayTransactionId: string | null;

  @Column({
    name: 'gateway_payment_url',
    type: 'varchar',
    length: 2048,
    nullable: true,
  })
  gatewayPaymentUrl: string | null;

  @Column({
    name: 'gateway_response_code',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  gatewayResponseCode: string | null;

  @Column({
    name: 'gateway_transaction_status',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  gatewayTransactionStatus: string | null;

  @Column({
    name: 'gateway_transaction_date',
    type: 'char',
    length: 14,
    nullable: true,
  })
  gatewayTransactionDate: string | null;

  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  idempotencyKey: string | null;

  @Column({
    name: 'refund_idempotency_key',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  refundIdempotencyKey: string | null;

  @Column({
    name: 'refund_request_id',
    type: 'varchar',
    length: 32,
    nullable: true,
  })
  refundRequestId: string | null;

  @Column({
    name: 'refund_previous_status',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  refundPreviousStatus: PaymentStatus | null;

  @Column({
    name: 'refund_gateway_transaction_id',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  refundGatewayTransactionId: string | null;

  @Column({
    name: 'refund_response_code',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  refundResponseCode: string | null;

  @Column({
    name: 'refund_transaction_status',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  refundTransactionStatus: string | null;

  @Column({
    name: 'refund_message',
    type: 'varchar',
    length: 255,
    nullable: true,
  })
  refundMessage: string | null;

  @Column({
    name: 'refund_reason',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  refundReason: string | null;

  @Column({ name: 'created_by_user_id', type: 'bigint', nullable: true })
  createdByUserId: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({
    name: 'created_by_user_id',
    foreignKeyConstraintName: 'fk_payments_created_by_user',
  })
  createdByUser: User | null;

  @Column({ name: 'refunded_by_user_id', type: 'bigint', nullable: true })
  refundedByUserId: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({
    name: 'refunded_by_user_id',
    foreignKeyConstraintName: 'fk_payments_refunded_by_user',
  })
  refundedByUser: User | null;

  @Column({
    name: 'paid_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
  })
  paidAt: Date | null;

  @Column({
    name: 'refunded_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
  })
  refundedAt: Date | null;

  @Column({
    name: 'refund_requested_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
  })
  refundRequestedAt: Date | null;

  @Column({
    name: 'refund_last_queried_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
  })
  refundLastQueriedAt: Date | null;

  @Column({
    name: 'expires_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
  })
  expiresAt: Date | null;

  @CreateDateColumn({
    name: 'created_at',
    type: 'datetime',
    precision: 6,
  })
  createdAt: Date;

  @UpdateDateColumn({
    name: 'updated_at',
    type: 'datetime',
    precision: 6,
  })
  updatedAt: Date;
}
