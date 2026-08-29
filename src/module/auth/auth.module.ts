import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RateLimitGuard } from '../../common/http/rate-limit.guard';
import { AccessTokenGuard } from './access-token.guard';
import { AccessTokenService } from './access-token.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { CustomerAuthorizationReader } from './authorization/customer-authorization-reader';
import { ActorsGuard } from './guards/actors.guard';
import { RolesGuard } from './guards/roles.guard';
import { Customer } from '../customer/schema/customer.entity';
import { User } from '../user/schema/user.entity';
import { CustomerAuthorizationService } from './customer-authorization.service';
import { PasswordHasherService } from './password-hasher.service';
import { UserAuthorizationService } from './user-authorization.service';
import { UserAuthorizationReader } from './authorization/user-authorization-reader';

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
      provide: CustomerAuthorizationReader,
      useClass: CustomerAuthorizationService,
    },
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
    CustomerAuthorizationReader,
    UserAuthorizationReader,
  ],
})
export class AuthModule {}
