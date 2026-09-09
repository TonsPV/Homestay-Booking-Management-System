import type { AuditLogInput } from './audit-log.types';
import type { AuditLog } from './schema/audit-log.entity';

export type AuditLogInsertInput = Pick<
  AuditLog,
  | 'actorType'
  | 'actorId'
  | 'action'
  | 'entityType'
  | 'entityId'
  | 'requestId'
  | 'metadata'
>;

export function buildAuditInsertInput(
  input: AuditLogInput,
): AuditLogInsertInput {
  return {
    actorType: input.actorType,
    actorId: input.actorId,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    requestId: input.requestId ?? null,
    metadata: input.metadata ?? null,
  };
}
