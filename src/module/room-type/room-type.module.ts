import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { RoomTypeAdminController } from './room-type-admin.controller';
import { RoomTypeController } from './room-type.controller';
import { RoomTypeService } from './room-type.service';
import { RoomType } from './schema/room-type.entity';

@Module({
  imports: [TypeOrmModule.forFeature([RoomType]), AuthModule],
  controllers: [RoomTypeController, RoomTypeAdminController],
  providers: [RoomTypeService],
})
export class RoomTypeModule {}
