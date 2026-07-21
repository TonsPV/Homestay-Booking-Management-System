import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RolesGuard } from '../../common/http';
import { AuthModule } from '../auth/auth.module';
import { User } from './schema/user.entity';
import { UserAdminController } from './user-admin.controller';
import { UserAdminService } from './user-admin.service';

@Module({
  imports: [TypeOrmModule.forFeature([User]), AuthModule],
  controllers: [UserAdminController],
  providers: [UserAdminService, RolesGuard],
})
export class UserModule {}
