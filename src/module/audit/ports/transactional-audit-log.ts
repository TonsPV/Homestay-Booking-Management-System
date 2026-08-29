import type { TransactionContext } from '../../../common/application/transaction';
import type { RecordAuditLogInput } from '../audit-log.types';

export abstract class TransactionalAuditLog {
  abstract record(
    context: TransactionContext,
    input: RecordAuditLogInput,
  ): Promise<void>;
}
