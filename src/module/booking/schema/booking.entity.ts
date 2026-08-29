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

import { Customer } from '../../customer/schema/customer.entity';
import { Payment } from '../../payment/schema/payment.entity';
import { Room } from '../../room/schema/room.entity';
import { User } from '../../user/schema/user.entity';
import {
  BookingPaymentStatus,
  BookingRequestIntentActorType,
  BookingStatus,
} from '../domain/booking-state';

@Entity('bookings')
@Index('uq_bookings_code', ['bookingCode'], { unique: true })
@Index('idx_bookings_customer', ['customerId'])
@Index('idx_bookings_created_by_user', ['createdByUserId'])
@Index('idx_bookings_room_date', ['roomId', 'checkInDate', 'checkOutDate'])
@Index('idx_bookings_status', ['status'])
@Index('idx_bookings_payment_status', ['paymentStatus'])
@Index('idx_bookings_payment_expires_at', ['paymentExpiresAt'])
@Index('idx_bookings_created_at_status', ['createdAt', 'status'])
@Index('idx_bookings_accepted_payment_owner', ['acceptedPaymentId', 'id'])
@Index(
  'uq_bookings_request_intent',
  ['requestIntentActorType', 'requestIntentActorId', 'requestIntentKey'],
  { unique: true },
)
@Check('chk_bookings_date_range', 'check_in_date < check_out_date')
@Check('chk_bookings_guest_count', 'guest_count > 0')
@Check('chk_bookings_total_amount', 'total_amount > 0')
@Check(
  'chk_bookings_request_intent_fields',
  `(request_intent_key IS NULL AND request_intent_actor_type IS NULL AND request_intent_actor_id IS NULL AND request_intent_hash IS NULL) OR (request_intent_key IS NOT NULL AND request_intent_actor_type IS NOT NULL AND request_intent_actor_id IS NOT NULL AND request_intent_hash IS NOT NULL)`,
)
export class Booking {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'booking_code', type: 'varchar', length: 40 })
  bookingCode: string;

  @Column({ name: 'customer_id', type: 'bigint' })
  customerId: string;

  @ManyToOne(() => Customer, { nullable: false })
  @JoinColumn({
    name: 'customer_id',
    foreignKeyConstraintName: 'bookings_ibfk_1',
  })
  customer: Customer;

  @Column({ name: 'room_id', type: 'bigint' })
  roomId: string;

  @ManyToOne(() => Room, { nullable: false })
  @JoinColumn({
    name: 'room_id',
    foreignKeyConstraintName: 'bookings_ibfk_2',
  })
  room: Room;

  @Column({ name: 'created_by_user_id', type: 'bigint', nullable: true })
  createdByUserId: string | null;

  @ManyToOne(() => User, { nullable: true })
  @JoinColumn({
    name: 'created_by_user_id',
    foreignKeyConstraintName: 'bookings_ibfk_3',
  })
  createdByUser: User | null;

  @Column({ name: 'check_in_date', type: 'date' })
  checkInDate: string;

  @Column({ name: 'check_out_date', type: 'date' })
  checkOutDate: string;

  @Column({ name: 'guest_count', type: 'int' })
  guestCount: number;

  @Column({ name: 'contact_name', type: 'varchar', length: 120 })
  contactName: string;

  @Column({ name: 'contact_phone', type: 'varchar', length: 30 })
  contactPhone: string;

  @Column({
    name: 'contact_email',
    type: 'varchar',
    length: 160,
    nullable: true,
  })
  contactEmail: string | null;

  @Column({
    name: 'total_amount',
    type: 'decimal',
    precision: 12,
    scale: 2,
    default: '0.00',
  })
  totalAmount: string;

  @Column({
    type: 'enum',
    enum: BookingStatus,
    default: BookingStatus.PENDING_PAYMENT,
  })
  status: BookingStatus;

  @Column({
    name: 'payment_status',
    type: 'enum',
    enum: BookingPaymentStatus,
    default: BookingPaymentStatus.UNPAID,
  })
  paymentStatus: BookingPaymentStatus;

  /**
   * The one accepted base-payment lineage for this booking.  It is retained
   * across refund states so a delayed callback cannot become a second
   * accepted collection after the original payment is refunded.
   */
  @Column({ name: 'accepted_payment_id', type: 'bigint', nullable: true })
  acceptedPaymentId: string | null;

  @ManyToOne(() => Payment, {
    nullable: true,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
  })
  @JoinColumn([
    {
      name: 'accepted_payment_id',
      referencedColumnName: 'id',
      foreignKeyConstraintName: 'fk_bookings_accepted_payment_owner',
    },
    { name: 'id', referencedColumnName: 'bookingId' },
  ])
  acceptedPayment: Payment | null;

  @Column({
    name: 'request_intent_actor_type',
    type: 'varchar',
    length: 16,
    nullable: true,
  })
  requestIntentActorType: BookingRequestIntentActorType | null;

  @Column({
    name: 'request_intent_actor_id',
    type: 'bigint',
    nullable: true,
  })
  requestIntentActorId: string | null;

  @Column({
    name: 'request_intent_key',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  requestIntentKey: string | null;

  @Column({
    name: 'request_intent_hash',
    type: 'char',
    length: 64,
    nullable: true,
  })
  requestIntentHash: string | null;

  @Column({
    name: 'payment_expires_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
  })
  paymentExpiresAt: Date | null;

  @Column({ name: 'customer_note', type: 'text', nullable: true })
  customerNote: string | null;

  @Column({
    name: 'cancelled_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
  })
  cancelledAt: Date | null;

  @Column({
    name: 'cancellation_reason',
    type: 'varchar',
    length: 500,
    nullable: true,
  })
  cancellationReason: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime' })
  updatedAt: Date;
}
