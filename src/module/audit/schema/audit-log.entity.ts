import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export enum AuditActorType {
  CUSTOMER = 'CUSTOMER',
  USER = 'USER',
  SYSTEM = 'SYSTEM',
}

export enum AuditAction {
  BOOKING_CREATED = 'BOOKING_CREATED',
  BOOKING_STATUS_CHANGED = 'BOOKING_STATUS_CHANGED',
  BOOKING_CANCELLED = 'BOOKING_CANCELLED',
  ROOM_STATUS_CHANGED = 'ROOM_STATUS_CHANGED',
  PAYMENT_CONFIRMED = 'PAYMENT_CONFIRMED',
  REFUND_REQUESTED = 'REFUND_REQUESTED',
  REFUND_COMPLETED = 'REFUND_COMPLETED',
  ACCOUNT_LOCKED = 'ACCOUNT_LOCKED',
  ACCOUNT_UNLOCKED = 'ACCOUNT_UNLOCKED',
}

export enum AuditEntityType {
  BOOKING = 'BOOKING',
  ROOM = 'ROOM',
  PAYMENT = 'PAYMENT',
  CUSTOMER = 'CUSTOMER',
  USER = 'USER',
}

export type AuditMetadata = Record<string, boolean | number | string | null>;

@Entity('audit_logs')
@Index('idx_audit_logs_action_created', ['action', 'createdAt'])
@Index('idx_audit_logs_entity_created', ['entityType', 'entityId', 'createdAt'])
@Index('idx_audit_logs_actor_created', ['actorType', 'actorId', 'createdAt'])
@Index('idx_audit_logs_request_id', ['requestId'])
export class AuditLog {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ name: 'actor_type', type: 'enum', enum: AuditActorType })
  actorType: AuditActorType;

  @Column({ name: 'actor_id', type: 'bigint', nullable: true })
  actorId: string | null;

  @Column({ type: 'enum', enum: AuditAction })
  action: AuditAction;

  @Column({ name: 'entity_type', type: 'enum', enum: AuditEntityType })
  entityType: AuditEntityType;

  @Column({ name: 'entity_id', type: 'varchar', length: 64 })
  entityId: string;

  @Column({ name: 'request_id', type: 'varchar', length: 200, nullable: true })
  requestId: string | null;

  @Column({ type: 'json', nullable: true })
  metadata: AuditMetadata | null;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 6 })
  createdAt: Date;
}
