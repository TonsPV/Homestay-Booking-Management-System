import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { CustomerModule } from '../customer/customer.module';
import { Customer } from '../customer/schema/customer.entity';
import { Payment } from '../payment/schema/payment.entity';
import { Room } from '../room/schema/room.entity';
import { User } from '../user/schema/user.entity';
import { BookingCreationService } from './booking-creation.service';
import { BookingExpirationService } from './booking-expiration.service';
import { BookingLifecycleService } from './booking-lifecycle.service';
import { BookingTransitionPolicy } from './booking-transition.policy';
import { BookingManagementController } from './booking-management.controller';
import { BookingQueryService } from './booking-query.service';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { Booking } from './schema/booking.entity';
import { RoomCalendar } from './schema/room-calendar.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Booking,
      RoomCalendar,
      Customer,
      Payment,
      Room,
      User,
    ]),
    AuthModule,
    CustomerModule,
  ],
  controllers: [BookingController, BookingManagementController],
  providers: [
    BookingService,
    BookingCreationService,
    BookingLifecycleService,
    BookingTransitionPolicy,
    BookingQueryService,
    BookingExpirationService,
  ],
})
export class BookingModule {}
