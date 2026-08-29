import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { User } from '../../user/schema/user.entity';
import { PaymentStatus } from '../domain/payment-state';
import { Payment } from './payment.entity';

/**
 * The single refund operation associated with a payment attempt.
 *
 * A PaymentRefund is deliberately separate from Payment because a refund has
 * its own idempotency key, gateway evidence, and reconciliation timestamps.
 * The unique payment_id index enforces the current no-partial-refund model.
 */
@Entity('payment_refunds')
@Index('uq_payment_refunds_payment', ['paymentId'], { unique: true })
@Index('uq_payment_refunds_idempotency', ['idempotencyKey'], { unique: true })
@Index('uq_payment_refunds_request', ['requestId'], { unique: true })
@Index('idx_payment_refunds_refunded_by_user', ['refundedByUserId'])
@Index('idx_payment_refunds_requested_at', ['requestedAt'])
export class PaymentRefund {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'payment_id', type: 'bigint' })
  paymentId: string;

  @ManyToOne(() => Payment, (payment) => payment.refund, {
    nullable: false,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
  })
  @JoinColumn({
    name: 'payment_id',
    referencedColumnName: 'id',
    foreignKeyConstraintName: 'fk_payment_refunds_payment',
  })
  payment: Payment;

  @Column({
    name: 'idempotency_key',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  idempotencyKey: string | null;

  @Column({ name: 'request_id', type: 'varchar', length: 32, nullable: true })
  requestId: string | null;

  @Column({
    name: 'previous_payment_status',
    type: 'varchar',
    length: 30,
    nullable: true,
  })
  previousPaymentStatus: PaymentStatus | null;

  @Column({
    name: 'gateway_transaction_id',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  gatewayTransactionId: string | null;

  @Column({
    name: 'response_code',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  responseCode: string | null;

  @Column({
    name: 'transaction_status',
    type: 'varchar',
    length: 10,
    nullable: true,
  })
  transactionStatus: string | null;

  @Column({ name: 'message', type: 'varchar', length: 255, nullable: true })
  message: string | null;

  @Column({ name: 'reason', type: 'varchar', length: 500, nullable: true })
  reason: string | null;

  @Column({ name: 'refunded_by_user_id', type: 'bigint', nullable: true })
  refundedByUserId: string | null;

  @ManyToOne(() => User, {
    nullable: true,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
  })
  @JoinColumn({
    name: 'refunded_by_user_id',
    referencedColumnName: 'id',
    foreignKeyConstraintName: 'fk_payment_refunds_refunded_by_user',
  })
  refundedByUser: User | null;

  @Column({
    name: 'requested_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
  })
  requestedAt: Date | null;

  @Column({
    name: 'refunded_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
  })
  refundedAt: Date | null;

  @Column({
    name: 'last_queried_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
  })
  lastQueriedAt: Date | null;

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
