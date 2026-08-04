import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';

import {
  ActorsGuard,
  CustomerAuthorizationReader,
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
import { CustomerAuthorizationService } from './customer-authorization.service';
import { CustomerClaimChallengeService } from './customer-claim-challenge.service';
import { CustomerClaimPolicy } from './customer-claim.policy';
import { CustomerClaimSmsProvider } from './customer-claim-sms.provider';
import { CustomerClaimSmsService } from './customer-claim-sms.service';
import { DisabledCustomerClaimSmsProvider } from './disabled-customer-claim-sms.provider';
import { LocalCustomerClaimService } from './local-customer-claim.service';
import { PasswordHasherService } from './password-hasher.service';
import { CustomerClaimChallenge } from './schema/customer-claim-challenge.entity';
import { UserAuthorizationService } from './user-authorization.service';
import { TestCustomerClaimSmsProvider } from './test-customer-claim-sms.provider';

@Module({
  imports: [TypeOrmModule.forFeature([Customer, CustomerClaimChallenge, User])],
  controllers: [AuthController],
  providers: [
    AuthService,
    CustomerClaimChallengeService,
    CustomerClaimPolicy,
    CustomerClaimSmsService,
    LocalCustomerClaimService,
    AccessTokenService,
    AccessTokenGuard,
    ActorsGuard,
    PasswordHasherService,
    RateLimitGuard,
    RolesGuard,
    {
      provide: CustomerClaimSmsProvider,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const provider = configService.getOrThrow<string>(
          'CUSTOMER_CLAIM_SMS_PROVIDER',
        );

        return provider === 'test'
          ? new TestCustomerClaimSmsProvider()
          : new DisabledCustomerClaimSmsProvider();
      },
    },
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
    CustomerClaimChallengeService,
    CustomerClaimPolicy,
    CustomerClaimSmsProvider,
    CustomerClaimSmsService,
  ],
})
export class AuthModule {}
