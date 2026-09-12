import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';
import {
  ApiResponse,
  ApiResponsePayload,
  RateLimit,
  RateLimitGuard,
} from '../../common/http';
import {
  ApiCommonAuthErrors,
  ApiCreatedEnvelope,
  ApiInvalidRequestError,
  ApiLoginFailureError,
  ApiOkEnvelope,
  ApiOkEnvelopeUnion,
  ApiRateLimitError,
  ApiRegistrationConflictError,
} from '../../openapi/api-response.decorators';
import { AuthService } from './auth.service';
import type {
  AccessTokenPayload,
  LoginResponse,
  MeResponse,
  RegistrationResult,
} from './auth.types';
import { CurrentAuth } from './decorators/current-auth.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LoginDto } from './dto/login.dto';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import { GoogleCustomerLoginDto } from './dto/google-customer-login.dto';
import {
  AuthLoginResponseDto,
  AuthMeCustomerResponseDto,
  AuthMeUserResponseDto,
  AuthRegistrationAcceptedDto,
} from './dto/auth-response.dto';

@Controller('v1/auth')
@UseGuards(RateLimitGuard)
@ApiRateLimitError()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('customers/register')
  @RateLimit({ limit: 5, windowMs: 15 * 60 * 1000 })
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedEnvelope(AuthRegistrationAcceptedDto)
  @ApiInvalidRequestError()
  @ApiRegistrationConflictError()
  registerCustomer(
    @Body() body: RegisterCustomerDto,
  ): Promise<ApiResponsePayload<RegistrationResult>> {
    return this.authService
      .registerCustomer(body)
      .then((result) =>
        ApiResponse.created(result, 'Dang ky tai khoan thanh cong.'),
      );
  }

  @Post('customers/google/login')
  @RateLimit({ limit: 10, windowMs: 15 * 60 * 1000 })
  @HttpCode(HttpStatus.OK)
  @ApiOkEnvelope(AuthLoginResponseDto)
  @ApiInvalidRequestError()
  @ApiLoginFailureError()
  @ApiRegistrationConflictError()
  loginCustomerWithGoogle(
    @Body() body: GoogleCustomerLoginDto,
  ): Promise<ApiResponsePayload<LoginResponse>> {
    return this.authService
      .loginCustomerWithGoogle(body)
      .then((result) => ApiResponse.ok(result, 'Dang nhap Google thanh cong.'));
  }

  @Post('login')
  @RateLimit({ limit: 10, windowMs: 15 * 60 * 1000 })
  @HttpCode(HttpStatus.OK)
  @ApiOkEnvelope(AuthLoginResponseDto)
  @ApiLoginFailureError()
  login(@Body() body: LoginDto): Promise<ApiResponsePayload<LoginResponse>> {
    return this.authService
      .login(body)
      .then((result) => ApiResponse.ok(result, 'Dang nhap thanh cong.'));
  }

  @Post('customers/login')
  @RateLimit({ limit: 10, windowMs: 15 * 60 * 1000 })
  @HttpCode(HttpStatus.OK)
  @ApiOkEnvelope(AuthLoginResponseDto)
  @ApiLoginFailureError()
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
  @ApiOkEnvelope(AuthLoginResponseDto)
  @ApiLoginFailureError()
  loginUser(
    @Body() body: LoginDto,
  ): Promise<ApiResponsePayload<LoginResponse>> {
    return this.authService
      .loginUser(body)
      .then((result) => ApiResponse.ok(result, 'Dang nhap thanh cong.'));
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOkEnvelopeUnion([AuthMeCustomerResponseDto, AuthMeUserResponseDto])
  @ApiCommonAuthErrors()
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
