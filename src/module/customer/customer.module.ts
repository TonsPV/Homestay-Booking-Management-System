import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { CustomerAdminController } from './customer-admin.controller';
import { CustomerAdminService } from './customer-admin.service';
import { CustomerProfileController } from './customer-profile.controller';
import { CustomerProfileService } from './customer-profile.service';
import { Customer } from './schema/customer.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Customer]), AuthModule],
  controllers: [CustomerProfileController, CustomerAdminController],
  providers: [CustomerProfileService, CustomerAdminService],
})
export class CustomerModule {}
