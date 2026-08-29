import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { Booking } from '../../booking/schema/booking.entity';
import { User } from '../../user/schema/user.entity';
import {
  PaymentMethod,
  PaymentReviewReason,
  PaymentStatus,
} from '../domain/payment-state';
import { PaymentRefund } from './payment-refund.entity';

@Entity('payments')
@Index('uq_payments_gateway_transaction', ['gatewayTransactionId'], {
  unique: true,
})
@Index('uq_payments_gateway_reference', ['gatewayReference'], {
  unique: true,
})
@Index('uq_payments_idempotency', ['idempotencyKey'], { unique: true })
@Index('uq_payments_id_booking', ['id', 'bookingId'], { unique: true })
@Index('idx_payments_booking', ['bookingId'])
@Index('idx_payments_status', ['status'])
@Index('idx_payments_created_by_user', ['createdByUserId'])
@Index('idx_payments_expires_at', ['expiresAt'])
@Index('idx_payments_status_paid_at', ['status', 'paidAt'])
@Index('idx_payments_created_at_status', ['createdAt', 'status'])
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
    name: 'review_reason',
    type: 'enum',
    enum: PaymentReviewReason,
    nullable: true,
  })
  reviewReason: PaymentReviewReason | null;

  @Column({
    name: 'review_canonical_payment_id',
    type: 'bigint',
    nullable: true,
  })
  reviewCanonicalPaymentId: string | null;

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

  @OneToOne(() => PaymentRefund, (refund) => refund.payment)
  refund: PaymentRefund | null;

  @Column({ name: 'created_by_user_id', type: 'bigint', nullable: true })
  createdByUserId: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({
    name: 'created_by_user_id',
    foreignKeyConstraintName: 'fk_payments_created_by_user',
  })
  createdByUser: User | null;

  @Column({
    name: 'paid_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
  })
  paidAt: Date | null;

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
