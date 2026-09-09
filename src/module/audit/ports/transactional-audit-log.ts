import type { TransactionContext } from '../../../common/application/transaction';
import type { AuditLogInput } from '../audit-log.types';

export abstract class TransactionalAuditLog {
  abstract record(
    context: TransactionContext,
    input: AuditLogInput,
  ): Promise<void>;
}
