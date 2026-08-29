import { Injectable } from '@nestjs/common';

import type { TransactionContext } from '../../../../common/application/transaction';
import { TypeOrmTransactionRunner } from '../../../../common/infrastructure/persistence/typeorm-transaction.runner';
import type { RecordAuditLogInput } from '../../audit-log.types';
import { TransactionalAuditLog } from '../../ports/transactional-audit-log';
import { AuditLog } from '../../schema/audit-log.entity';

@Injectable()
export class TypeOrmTransactionalAuditLog extends TransactionalAuditLog {
  constructor(private readonly transactions: TypeOrmTransactionRunner) {
    super();
  }

  async record(
    context: TransactionContext,
    input: RecordAuditLogInput,
  ): Promise<void> {
    await this.transactions
      .managerFor(context)
      .getRepository(AuditLog)
      .insert({
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
