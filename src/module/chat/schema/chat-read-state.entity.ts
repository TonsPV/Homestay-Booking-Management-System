import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

import { ChatConversation } from './chat-conversation.entity';

@Entity('chat_read_states')
@Index(
  'uq_chat_read_states_conversation_actor',
  ['conversationId', 'actorType', 'actorId'],
  { unique: true },
)
@Index('idx_chat_read_states_actor', ['actorType', 'actorId'])
@Check('chk_chat_read_states_last_sequence', 'last_read_sequence >= 0')
@Check('chk_chat_read_states_actor_type', "actor_type IN ('customer', 'user')")
export class ChatReadState {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'conversation_id', type: 'bigint' })
  conversationId: string;

  @ManyToOne(() => ChatConversation, {
    nullable: false,
    onDelete: 'RESTRICT',
    onUpdate: 'RESTRICT',
  })
  @JoinColumn({
    name: 'conversation_id',
    foreignKeyConstraintName: 'chat_read_states_ibfk_1',
  })
  conversation: ChatConversation;

  @Column({ name: 'actor_type', type: 'varchar', length: 16 })
  actorType: 'customer' | 'user';

  @Column({ name: 'actor_id', type: 'bigint' })
  actorId: string;

  @Column({ name: 'last_read_sequence', type: 'int', default: 0 })
  lastReadSequence: number;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 6 })
  updatedAt: Date;
}
