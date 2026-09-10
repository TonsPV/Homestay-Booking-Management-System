import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { PersistenceTransactionModule } from '../../common/database/persistence-transaction.module';
import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { BOOKING_STAY_POLICY_PROVIDER } from '../booking/booking-stay.provider';
import { Booking } from '../booking/schema/booking.entity';
import { RoomCalendar } from '../booking/schema/room-calendar.entity';
import { RoomType } from '../room-type/schema/room-type.entity';
import { RoomTypeBed } from '../room-type/schema/room-type-bed.entity';
import { RoomImageController } from './room-image.controller';
import { RoomImageService } from './room-image.service';
import { RoomImageStorageService } from './room-image-storage.service';
import { RoomManagementController } from './room-management.controller';
import { RoomAvailabilityService } from './room-availability.service';
import { RoomController } from './room.controller';
import { RoomMutationService } from './room-mutation.service';
import { RoomQueryService } from './room-query.service';
import { RoomService } from './room.service';
import { RoomStatusTransitionPolicy } from './domain/room-status-transition.policy';
import { TypeOrmRoomCalendarManagementStore } from './persistence/typeorm-room-calendar-management.store';
import { RoomCalendarManagementStore } from './ports/room-calendar-management.store';
import { RoomImage } from './schema/room-image.entity';
import { Room } from './schema/room.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Room,
      RoomImage,
      RoomType,
      RoomTypeBed,
      RoomCalendar,
      Booking,
    ]),
    AuthModule,
    AuditModule,
    PersistenceTransactionModule,
  ],
  controllers: [RoomController, RoomManagementController, RoomImageController],
  providers: [
    RoomService,
    RoomQueryService,
    RoomMutationService,
    RoomStatusTransitionPolicy,
    RoomImageService,
    RoomImageStorageService,
    RoomAvailabilityService,
    TypeOrmRoomCalendarManagementStore,
    {
      provide: RoomCalendarManagementStore,
      useExisting: TypeOrmRoomCalendarManagementStore,
    },
    BOOKING_STAY_POLICY_PROVIDER,
  ],
})
export class RoomModule {}
