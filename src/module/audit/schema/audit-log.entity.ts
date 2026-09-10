import type { AuditMetadata } from '../audit-log.types';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
} from '../domain/audit-log';

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
