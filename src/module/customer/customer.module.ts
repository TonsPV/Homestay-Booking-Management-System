import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { CustomerAdminController } from './customer-admin.controller';
import { CustomerAdminService } from './customer-admin.service';
import { CustomerCredentialManagementController } from './customer-credential-management.controller';
import { CustomerCredentialLookupService } from './customer-credential-lookup.service';
import { CustomerCredentialPolicy } from './customer-credential.policy';
import { CustomerCredentialService } from './customer-credential.service';
import { CustomerProfileController } from './customer-profile.controller';
import { CustomerProfileService } from './customer-profile.service';
import { Customer } from './schema/customer.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Customer]), AuthModule, AuditModule],
  controllers: [
    CustomerProfileController,
    CustomerAdminController,
    CustomerCredentialManagementController,
  ],
  providers: [
    CustomerProfileService,
    CustomerAdminService,
    CustomerCredentialPolicy,
    CustomerCredentialLookupService,
    CustomerCredentialService,
  ],
  exports: [CustomerCredentialPolicy, CustomerCredentialLookupService],
})
export class CustomerModule {}
