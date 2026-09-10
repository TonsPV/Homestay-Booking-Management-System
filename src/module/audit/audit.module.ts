import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PersistenceTransactionModule } from '../../common/database/persistence-transaction.module';
import { AuditLogService } from './audit-log.service';
import { TypeOrmTransactionalAuditLog } from './persistence/typeorm-transactional-audit-log';
import { TransactionalAuditLog } from './ports/transactional-audit-log';
import { AuditLog } from './schema/audit-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([AuditLog]), PersistenceTransactionModule],
  providers: [
    AuditLogService,
    TypeOrmTransactionalAuditLog,
    {
      provide: TransactionalAuditLog,
      useExisting: TypeOrmTransactionalAuditLog,
    },
  ],
  exports: [
    AuditLogService,
    TransactionalAuditLog,
    TypeOrmTransactionalAuditLog,
  ],
})
export class AuditModule {}
