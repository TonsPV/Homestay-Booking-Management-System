import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { AmenityAdminController } from './amenity-admin.controller';
import { AmenityController } from './amenity.controller';
import { AmenityService } from './amenity.service';
import { Amenity } from './schema/amenity.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Amenity]), AuthModule],
  controllers: [AmenityController, AmenityAdminController],
  providers: [AmenityService],
  exports: [AmenityService],
})
export class AmenityModule {}
