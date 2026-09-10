import { Injectable } from '@nestjs/common';
import type { EntityManager } from 'typeorm';

import { buildAuditInsertInput } from './audit-log.mapper';
import type { AuditLogInput } from './audit-log.types';
import { AuditLog } from './schema/audit-log.entity';

export type { AuditActorContext, AuditLogInput } from './audit-log.types';

@Injectable()
export class AuditLogService {
  async record(manager: EntityManager, input: AuditLogInput): Promise<void> {
    await manager.getRepository(AuditLog).insert(buildAuditInsertInput(input));
  }
}
