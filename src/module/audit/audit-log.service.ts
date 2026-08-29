import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import type { RecordAuditLogInput } from './audit-log.types';
import { AuditLog } from './schema/audit-log.entity';

export type { AuditActorContext, RecordAuditLogInput } from './audit-log.types';

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
