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

export interface AuditLogInput extends AuditActorContext {
  action: AuditAction;
  entityType: AuditEntityType;
  entityId: string;
  metadata?: AuditMetadata;
}

export type AuditMetadata = Record<string, boolean | number | string | null>;
