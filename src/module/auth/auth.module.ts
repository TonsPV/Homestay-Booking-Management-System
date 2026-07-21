import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AccessTokenGuard } from './access-token.guard';
import { AccessTokenService } from './access-token.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { Customer } from '../customer/schema/customer.entity';
import { User } from '../user/schema/user.entity';
import { PasswordHasherService } from './password-hasher.service';

@Module({
  imports: [TypeOrmModule.forFeature([Customer, User])],
  controllers: [AuthController],
  providers: [
    AuthService,
    AccessTokenService,
    AccessTokenGuard,
    PasswordHasherService,
  ],
  exports: [AccessTokenService, AccessTokenGuard, PasswordHasherService],
})
export class AuthModule {}
