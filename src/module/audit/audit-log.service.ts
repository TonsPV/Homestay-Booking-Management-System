import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
  AuditLog,
  type AuditMetadata,
} from './schema/audit-log.entity';

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

@Injectable()
export class AuditLogService {
  async record(
    manager: EntityManager,
    input: RecordAuditLogInput,
  ): Promise<void> {
    await manager.getRepository(AuditLog).insert({
      actorType: input.actorType,
      actorId: input.actorId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      requestId: input.requestId ?? null,
      metadata: input.metadata ?? null,
    });
  }
}
