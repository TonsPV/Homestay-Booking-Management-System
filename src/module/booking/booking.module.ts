import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PersistenceTransactionModule } from '../../common/infrastructure/persistence/persistence-transaction.module';
import { AuditModule } from '../audit/audit.module';
import { AuthModule } from '../auth/auth.module';
import { CustomerModule } from '../customer/customer.module';
import { Customer } from '../customer/schema/customer.entity';
import { PaymentPersistenceModule } from '../payment/infrastructure/persistence/payment-persistence.module';
import { Payment } from '../payment/schema/payment.entity';
import { Room } from '../room/schema/room.entity';
import { User } from '../user/schema/user.entity';
import { BookingCreationService } from './booking-creation.service';
import { BookingExpirationService } from './booking-expiration.service';
import { BookingLifecycleService } from './booking-lifecycle.service';
import { BookingManagementController } from './booking-management.controller';
import { BookingPaymentLifecycleService } from './booking-payment-lifecycle.service';
import { BookingQueryService } from './booking-query.service';
import { BOOKING_STAY_POLICY_PROVIDER } from './booking-stay.provider';
import { BookingController } from './booking.controller';
import { BookingService } from './booking.service';
import { BookingTransitionPolicy } from './domain/booking-transition.policy';
import {
  TypeOrmBookingCreationStore,
  TypeOrmBookingCustomerStore,
  TypeOrmBookingRoomStore,
} from './infrastructure/persistence/typeorm-booking-creation.store';
import {
  TypeOrmBookingLifecycleStore,
  TypeOrmBookingPaymentStateStore,
} from './infrastructure/persistence/typeorm-booking-lifecycle.store';
import { TypeOrmRoomCalendarStore } from './infrastructure/persistence/typeorm-room-calendar.store';
import {
  BookingCreationStore,
  BookingCustomerStore,
  BookingRoomStore,
} from './ports/booking-creation.store';
import {
  BookingLifecycleStore,
  BookingPaymentStateStore,
} from './ports/booking-lifecycle.store';
import { RoomCalendarStore } from './ports/room-calendar.store';
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
    AuditModule,
    PersistenceTransactionModule,
    PaymentPersistenceModule,
    CustomerModule,
  ],
  controllers: [BookingController, BookingManagementController],
  providers: [
    BookingService,
    BookingCreationService,
    BookingLifecycleService,
    BookingPaymentLifecycleService,
    BookingTransitionPolicy,
    BOOKING_STAY_POLICY_PROVIDER,
    BookingQueryService,
    BookingExpirationService,
    TypeOrmBookingCreationStore,
    { provide: BookingCreationStore, useExisting: TypeOrmBookingCreationStore },
    TypeOrmBookingCustomerStore,
    { provide: BookingCustomerStore, useExisting: TypeOrmBookingCustomerStore },
    TypeOrmBookingRoomStore,
    { provide: BookingRoomStore, useExisting: TypeOrmBookingRoomStore },
    TypeOrmBookingLifecycleStore,
    {
      provide: BookingLifecycleStore,
      useExisting: TypeOrmBookingLifecycleStore,
    },
    TypeOrmBookingPaymentStateStore,
    {
      provide: BookingPaymentStateStore,
      useExisting: TypeOrmBookingPaymentStateStore,
    },
    TypeOrmRoomCalendarStore,
    { provide: RoomCalendarStore, useExisting: TypeOrmRoomCalendarStore },
  ],
  exports: [BookingPaymentLifecycleService],
})
export class BookingModule {}
