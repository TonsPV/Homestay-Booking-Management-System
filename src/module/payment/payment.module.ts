import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PersistenceTransactionModule } from '../../common/infrastructure/persistence/persistence-transaction.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { BookingModule } from '../booking/booking.module';
import { Booking } from '../booking/schema/booking.entity';
import { User } from '../user/schema/user.entity';
import { PaymentManagementController } from './payment-management.controller';
import { PaymentPersistenceModule } from './infrastructure/persistence/payment-persistence.module';
import { PaymentCollectionService } from './payment-collection.service';
import { PaymentExpirationService } from './payment-expiration.service';
import { PaymentManualService } from './payment-manual.service';
import { PaymentController } from './payment.controller';
import { PaymentQueryService } from './payment-query.service';
import { PaymentRefundService } from './payment-refund.service';
import { PaymentService } from './payment.service';
import { Payment } from './schema/payment.entity';
import { PaymentRefund } from './schema/payment-refund.entity';
import { VnPayController } from './vnpay.controller';
import { VnPayGatewayService } from './vnpay-gateway.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, PaymentRefund, Booking, User]),
    PersistenceTransactionModule,
    AuditModule,
    AuthModule,
    BookingModule,
    PaymentPersistenceModule,
  ],
  controllers: [
    PaymentController,
    PaymentManagementController,
    VnPayController,
  ],
  providers: [
    PaymentService,
    PaymentCollectionService,
    PaymentManualService,
    PaymentQueryService,
    PaymentRefundService,
    PaymentExpirationService,
    VnPayGatewayService,
  ],
})
export class PaymentModule {}
