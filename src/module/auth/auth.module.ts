import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  ActorsGuard,
  RateLimitGuard,
  RolesGuard,
  UserAuthorizationReader,
} from '../../common/http';
import { AccessTokenGuard } from './access-token.guard';
import { AccessTokenService } from './access-token.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { Customer } from '../customer/schema/customer.entity';
import { User } from '../user/schema/user.entity';
import { PasswordHasherService } from './password-hasher.service';
import { UserAuthorizationService } from './user-authorization.service';

@Module({
  imports: [TypeOrmModule.forFeature([Customer, User])],
  controllers: [AuthController],
  providers: [
    AuthService,
    AccessTokenService,
    AccessTokenGuard,
    ActorsGuard,
    PasswordHasherService,
    RateLimitGuard,
    RolesGuard,
    {
      provide: UserAuthorizationReader,
      useClass: UserAuthorizationService,
    },
  ],
  exports: [
    AccessTokenService,
    AccessTokenGuard,
    ActorsGuard,
    PasswordHasherService,
    RateLimitGuard,
    RolesGuard,
    UserAuthorizationReader,
  ],
})
export class AuthModule {}
