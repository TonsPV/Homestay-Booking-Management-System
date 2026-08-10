import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { AuditModule } from '../audit/audit.module';
import { User } from './schema/user.entity';
import { UserAdminController } from './user-admin.controller';
import { UserAdminService } from './user-admin.service';

@Module({
  imports: [TypeOrmModule.forFeature([User]), AuthModule, AuditModule],
  controllers: [UserAdminController],
  providers: [UserAdminService],
})
export class UserModule {}
