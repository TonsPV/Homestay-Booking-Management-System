import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { Booking } from '../booking/schema/booking.entity';
import { RoomCalendar } from '../booking/schema/room-calendar.entity';
import { User } from '../user/schema/user.entity';
import { PaymentManagementController } from './payment-management.controller';
import { PaymentExpirationService } from './payment-expiration.service';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';
import { Payment } from './schema/payment.entity';
import { VnPayController } from './vnpay.controller';
import { VnPayGatewayService } from './vnpay-gateway.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Payment, Booking, RoomCalendar, User]),
    AuthModule,
  ],
  controllers: [
    PaymentController,
    PaymentManagementController,
    VnPayController,
  ],
  providers: [PaymentService, PaymentExpirationService, VnPayGatewayService],
})
export class PaymentModule {}
