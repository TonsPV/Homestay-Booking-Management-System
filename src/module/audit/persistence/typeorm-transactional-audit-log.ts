import { Injectable } from '@nestjs/common';

import type { TransactionContext } from '../../../common/database/transaction';
import { TypeOrmTransactionRunner } from '../../../common/database/typeorm-transaction.runner';
import { buildAuditInsertInput } from '../audit-log.mapper';
import type { AuditLogInput } from '../audit-log.types';
import { TransactionalAuditLog } from '../ports/transactional-audit-log';
import { AuditLog } from '../schema/audit-log.entity';

@Injectable()
export class TypeOrmTransactionalAuditLog extends TransactionalAuditLog {
  constructor(private readonly transactions: TypeOrmTransactionRunner) {
    super();
  }

  async record(
    context: TransactionContext,
    input: AuditLogInput,
  ): Promise<void> {
    await this.transactions
      .managerFor(context)
      .getRepository(AuditLog)
      .insert(buildAuditInsertInput(input));
  }
}
