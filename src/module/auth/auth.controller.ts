import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';

import {
  ApiResponse,
  ApiResponsePayload,
  CurrentAuth,
  RateLimit,
  RateLimitGuard,
  type AccessTokenPayload,
} from '../../common/http';
import { AccessTokenGuard } from './access-token.guard';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import type {
  CustomerResponse,
  LoginResponse,
  MeResponse,
} from './auth.service';

@Controller('v1/auth')
@UseGuards(RateLimitGuard)
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('customers/register')
  @RateLimit({ limit: 5, windowMs: 15 * 60 * 1000 })
  @HttpCode(HttpStatus.CREATED)
  registerCustomer(
    @Body() body: RegisterCustomerDto,
  ): Promise<ApiResponsePayload<CustomerResponse>> {
    return this.authService
      .registerCustomer(body)
      .then((customer) => ApiResponse.created(customer, 'Dang ky thanh cong.'));
  }

  @Post('customers/login')
  @RateLimit({ limit: 10, windowMs: 15 * 60 * 1000 })
  @HttpCode(HttpStatus.OK)
  loginCustomer(
    @Body() body: LoginDto,
  ): Promise<ApiResponsePayload<LoginResponse>> {
    return this.authService
      .loginCustomer(body)
      .then((result) => ApiResponse.ok(result, 'Dang nhap thanh cong.'));
  }

  @Post('users/login')
  @RateLimit({ limit: 10, windowMs: 15 * 60 * 1000 })
  @HttpCode(HttpStatus.OK)
  loginUser(
    @Body() body: LoginDto,
  ): Promise<ApiResponsePayload<LoginResponse>> {
    return this.authService
      .loginUser(body)
      .then((result) => ApiResponse.ok(result, 'Dang nhap thanh cong.'));
  }

  @Get('me')
  @UseGuards(AccessTokenGuard)
  me(
    @CurrentAuth() auth: AccessTokenPayload,
  ): Promise<ApiResponsePayload<MeResponse>> {
    return this.authService
      .getMe(auth)
      .then((result) =>
        ApiResponse.ok(result, 'Lay thong tin dang nhap thanh cong.'),
      );
  }
}
