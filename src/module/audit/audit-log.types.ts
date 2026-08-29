import type { AuditMetadata } from './schema/audit-log.entity';
import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
} from './domain/audit-log';

export interface AuditActorContext {
  actorType: AuditActorType;
  actorId: string | null;
  requestId?: string;
}

export interface RecordAuditLogInput extends AuditActorContext {
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  metadata?: AuditMetadata;
}
