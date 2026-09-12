import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { TypeOrmModule } from '@nestjs/typeorm';

import { RateLimitGuard } from '../../common/http/rate-limit.guard';
import { AccessTokenService } from './access-token.service';
import { AccessTokenClaimsValidator } from './access-token-claims.validator';
import { AccessTokenPrincipalService } from './access-token-principal.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { JwtStrategy } from './strategies/jwt.strategy';
import { CustomerAuthorizationReader } from './authorization/customer-authorization-reader';
import { ActorsGuard } from './guards/actors.guard';
import { RolesGuard } from './guards/roles.guard';
import { Customer } from '../customer/schema/customer.entity';
import { User } from '../user/schema/user.entity';
import { CustomerAuthorizationService } from './customer-authorization.service';
import { PasswordHasherService } from './password-hasher.service';
import { UserAuthorizationService } from './user-authorization.service';
import { UserAuthorizationReader } from './authorization/user-authorization-reader';
import { CustomerAuthIdentity } from './schema/customer-auth-identity.entity';
import { GoogleIdentityVerifier } from './google-identity.verifier';

@Module({
  imports: [
    TypeOrmModule.forFeature([Customer, User, CustomerAuthIdentity]),
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.getOrThrow<string>('JWT_ACCESS_TOKEN_SECRET'),
        signOptions: {
          algorithm: 'HS256' as const,
          // typ defaults to JWT in jsonwebtoken, but stating the full header
          // keeps the exact header contract; AccessTokenService.verify()
          // still asserts alg/typ per-token.
          header: { alg: 'HS256' as const, typ: 'JWT' },
        },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    GoogleIdentityVerifier,
    AccessTokenService,
    AccessTokenClaimsValidator,
    AccessTokenPrincipalService,
    ActorsGuard,
    JwtStrategy,
    JwtAuthGuard,
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
    AccessTokenPrincipalService,
    ActorsGuard,
    JwtAuthGuard,
    PasswordHasherService,
    RateLimitGuard,
    RolesGuard,
    CustomerAuthorizationReader,
    UserAuthorizationReader,
  ],
})
export class AuthModule {}
