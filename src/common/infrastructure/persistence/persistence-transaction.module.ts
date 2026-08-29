import { Module } from '@nestjs/common';

import { TransactionRunner } from '../../application/transaction';
import { TypeOrmTransactionRunner } from './typeorm-transaction.runner';

@Module({
  providers: [
    TypeOrmTransactionRunner,
    {
      provide: TransactionRunner,
      useExisting: TypeOrmTransactionRunner,
    },
  ],
  exports: [TransactionRunner, TypeOrmTransactionRunner],
})
export class PersistenceTransactionModule {}
