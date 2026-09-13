import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';

import { ChatConversation } from './chat-conversation.entity';

@Entity('chat_messages')
@Index(
  'uq_chat_messages_conversation_sequence',
  ['conversationId', 'sequence'],
  { unique: true },
)
@Index(
  'uq_chat_messages_sender_client_message',
  ['conversationId', 'senderActorType', 'senderActorId', 'clientMessageId'],
  { unique: true },
)
@Index('idx_chat_messages_conversation_sequence', [
  'conversationId',
  'sequence',
])
@Index('idx_chat_messages_sender_conversation_sequence', [
  'senderActorType',
  'conversationId',
  'sequence',
])
@Check('chk_chat_messages_sequence', 'sequence > 0')
@Check(
  'chk_chat_messages_sender_actor_type',
  "sender_actor_type IN ('customer', 'user')",
)
export class ChatMessage {
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
    foreignKeyConstraintName: 'chat_messages_ibfk_1',
  })
  conversation: ChatConversation;

  @Column({ type: 'int' })
  sequence: number;

  @Column({ name: 'sender_actor_type', type: 'varchar', length: 16 })
  senderActorType: 'customer' | 'user';

  @Column({ name: 'sender_actor_id', type: 'bigint' })
  senderActorId: string;

  @Column({ type: 'varchar', length: 2000 })
  content: string;

  @Column({ name: 'client_message_id', type: 'varchar', length: 100 })
  clientMessageId: string;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 6 })
  createdAt: Date;
}
