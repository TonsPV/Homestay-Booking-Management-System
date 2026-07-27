import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { Amenity } from '../amenity/schema/amenity.entity';
import { RoomTypeAdminController } from './room-type-admin.controller';
import { RoomTypeController } from './room-type.controller';
import { RoomTypeService } from './room-type.service';
import { RoomType } from './schema/room-type.entity';

@Module({
  imports: [TypeOrmModule.forFeature([RoomType, Amenity]), AuthModule],
  controllers: [RoomTypeController, RoomTypeAdminController],
  providers: [RoomTypeService],
})
export class RoomTypeModule {}
