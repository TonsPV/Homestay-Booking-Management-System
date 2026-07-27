import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { Customer } from '../customer/schema/customer.entity';
import { Payment } from '../payment/schema/payment.entity';
import { Room } from '../room/schema/room.entity';
import { User } from '../user/schema/user.entity';
import { BookingExpirationService } from './booking-expiration.service';
import { BookingManagementController } from './booking-management.controller';
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
  ],
  controllers: [BookingController, BookingManagementController],
  providers: [BookingService, BookingExpirationService],
})
export class BookingModule {}
