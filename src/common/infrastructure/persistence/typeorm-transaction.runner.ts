import { Injectable } from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';

import {
  type TransactionContext,
  TransactionRunner,
} from '../../application/transaction';

@Injectable()
export class TypeOrmTransactionRunner extends TransactionRunner {
  private readonly managers = new WeakMap<object, EntityManager>();

  constructor(private readonly dataSource: DataSource) {
    super();
  }

  run<T>(work: (context: TransactionContext) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      const context = Object.freeze({}) as TransactionContext;
      this.managers.set(context, manager);

      try {
        return await work(context);
      } finally {
        this.managers.delete(context);
      }
    });
  }

  managerFor(context: TransactionContext): EntityManager {
    const manager = this.managers.get(context);

    if (manager === undefined) {
      throw new Error('Transaction context is no longer active.');
    }

    return manager;
  }
}
