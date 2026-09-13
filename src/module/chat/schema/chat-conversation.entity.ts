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

/** One shared support conversation for one booking. */
@Entity('chat_conversations')
@Index('uq_chat_conversations_booking', ['bookingId'], { unique: true })
@Index('idx_chat_conversations_last_message_at', ['lastMessageAt'])
@Index('idx_chat_conversations_last_actor_message_at', [
  'lastMessageActorType',
  'lastMessageAt',
])
@Check('chk_chat_conversations_last_sequence', 'last_sequence >= 0')
@Check(
  'chk_chat_conversations_last_message_actor_type',
  "last_message_actor_type IS NULL OR last_message_actor_type IN ('customer', 'user')",
)
export class ChatConversation {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'booking_id', type: 'bigint' })
  bookingId: string;

  // The unique booking index carries the one-to-one invariant. A many-to-one
  // relation avoids TypeORM creating an additional anonymous unique key.
  @ManyToOne(() => Booking, {
    nullable: false,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
  })
  @JoinColumn({
    name: 'booking_id',
    foreignKeyConstraintName: 'chat_conversations_ibfk_1',
  })
  booking: Booking;

  /** The last committed message sequence. It is allocated while this row is locked. */
  @Column({ name: 'last_sequence', type: 'int', default: 0 })
  lastSequence: number;

  @Column({
    name: 'last_message_content',
    type: 'varchar',
    length: 2000,
    nullable: true,
  })
  lastMessageContent: string | null;

  @Column({
    name: 'last_message_actor_type',
    type: 'varchar',
    length: 16,
    nullable: true,
  })
  lastMessageActorType: 'customer' | 'user' | null;

  @Column({
    name: 'last_message_actor_id',
    type: 'bigint',
    nullable: true,
  })
  lastMessageActorId: string | null;

  @Column({
    name: 'last_message_at',
    type: 'datetime',
    precision: 6,
    nullable: true,
  })
  lastMessageAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 6 })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 6 })
  updatedAt: Date;
}
