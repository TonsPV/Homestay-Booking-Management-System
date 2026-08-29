import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PersistenceTransactionModule } from '../../common/infrastructure/persistence/persistence-transaction.module';
import { TypeOrmTransactionalAuditLog } from '../audit/infrastructure/persistence/typeorm-transactional-audit-log';
import { TransactionalAuditLog } from '../audit/ports/transactional-audit-log';
import { AuthModule } from '../auth/auth.module';
import { BookingModule } from '../booking/booking.module';
import { TypeOrmRoomCalendarStore } from '../booking/infrastructure/persistence/typeorm-room-calendar.store';
import { RoomCalendarStore } from '../booking/ports/room-calendar.store';
import { Booking } from '../booking/schema/booking.entity';
import { RoomCalendar } from '../booking/schema/room-calendar.entity';
import { User } from '../user/schema/user.entity';
import { PaymentManagementController } from './payment-management.controller';
import { TypeOrmPaymentAcceptanceStore } from './infrastructure/persistence/typeorm-payment-acceptance.store';
import { TypeOrmPaymentRefundStore } from './infrastructure/persistence/typeorm-payment-refund.store';
import { PaymentCollectionService } from './payment-collection.service';
import { PaymentExpirationService } from './payment-expiration.service';
import { PaymentManualService } from './payment-manual.service';
import { PaymentController } from './payment.controller';
import { PaymentQueryService } from './payment-query.service';
import { PaymentRefundService } from './payment-refund.service';
import { PaymentAcceptanceStore } from './ports/payment-acceptance.store';
import { PaymentRefundStore } from './ports/payment-refund.store';
import { PaymentService } from './payment.service';
import { Payment } from './schema/payment.entity';
import { PaymentRefund } from './schema/payment-refund.entity';
import { VnPayController } from './vnpay.controller';
import { VnPayGatewayService } from './vnpay-gateway.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Payment,
      PaymentRefund,
      Booking,
      RoomCalendar,
      User,
    ]),
    PersistenceTransactionModule,
    AuthModule,
    BookingModule,
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
    TypeOrmPaymentAcceptanceStore,
    {
      provide: PaymentAcceptanceStore,
      useExisting: TypeOrmPaymentAcceptanceStore,
    },
    TypeOrmPaymentRefundStore,
    { provide: PaymentRefundStore, useExisting: TypeOrmPaymentRefundStore },
    TypeOrmRoomCalendarStore,
    { provide: RoomCalendarStore, useExisting: TypeOrmRoomCalendarStore },
    TypeOrmTransactionalAuditLog,
    {
      provide: TransactionalAuditLog,
      useExisting: TypeOrmTransactionalAuditLog,
    },
  ],
})
export class PaymentModule {}
