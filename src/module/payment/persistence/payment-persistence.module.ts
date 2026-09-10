import { Module } from '@nestjs/common';

import { PersistenceTransactionModule } from '../../../common/database/persistence-transaction.module';
import { PaymentAcceptanceStore } from '../ports/payment-acceptance.store';
import { PaymentRefundStore } from '../ports/payment-refund.store';
import { TypeOrmPaymentAcceptanceStore } from './typeorm-payment-acceptance.store';
import { TypeOrmPaymentRefundStore } from './typeorm-payment-refund.store';

@Module({
  imports: [PersistenceTransactionModule],
  providers: [
    TypeOrmPaymentAcceptanceStore,
    {
      provide: PaymentAcceptanceStore,
      useExisting: TypeOrmPaymentAcceptanceStore,
    },
    TypeOrmPaymentRefundStore,
    {
      provide: PaymentRefundStore,
      useExisting: TypeOrmPaymentRefundStore,
    },
  ],
  exports: [PaymentAcceptanceStore, PaymentRefundStore],
})
export class PaymentPersistenceModule {}
