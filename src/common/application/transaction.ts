declare const TRANSACTION_CONTEXT_BRAND: unique symbol;

export interface TransactionContext {
  readonly [TRANSACTION_CONTEXT_BRAND]: true;
}

export abstract class TransactionRunner {
  abstract run<T>(
    work: (context: TransactionContext) => Promise<T>,
  ): Promise<T>;
}
