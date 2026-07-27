import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { Booking } from '../booking/schema/booking.entity';
import { RoomCalendar } from '../booking/schema/room-calendar.entity';
import { RoomType } from '../room-type/schema/room-type.entity';
import { RoomImageController } from './room-image.controller';
import { RoomImageService } from './room-image.service';
import { RoomImageStorageService } from './room-image-storage.service';
import { RoomManagementController } from './room-management.controller';
import { RoomAvailabilityService } from './room-availability.service';
import { RoomController } from './room.controller';
import { RoomService } from './room.service';
import { RoomImage } from './schema/room-image.entity';
import { Room } from './schema/room.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Room,
      RoomImage,
      RoomType,
      RoomCalendar,
      Booking,
    ]),
    AuthModule,
  ],
  controllers: [RoomController, RoomManagementController, RoomImageController],
  providers: [
    RoomService,
    RoomImageService,
    RoomImageStorageService,
    RoomAvailabilityService,
  ],
})
export class RoomModule {}
