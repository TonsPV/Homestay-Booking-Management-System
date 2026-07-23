import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { RoomType } from '../room-type/schema/room-type.entity';
import { RoomImageController } from './room-image.controller';
import { RoomImageService } from './room-image.service';
import { RoomManagementController } from './room-management.controller';
import { RoomController } from './room.controller';
import { RoomService } from './room.service';
import { RoomImage } from './schema/room-image.entity';
import { Room } from './schema/room.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Room, RoomImage, RoomType]), AuthModule],
  controllers: [RoomController, RoomManagementController, RoomImageController],
  providers: [RoomService, RoomImageService],
})
export class RoomModule {}
