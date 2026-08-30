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
import type { AccessTokenPayload } from './auth.types';
import { CurrentAuth } from './decorators/current-auth.decorator';
import { JwtAuthGuard } from './guards/jwt-auth.guard';
import { LoginDto } from './dto/login.dto';
import { RegisterCustomerDto } from './dto/register-customer.dto';
import {
  AuthLoginResponseDto,
  AuthMeCustomerResponseDto,
  AuthMeUserResponseDto,
  AuthRegistrationAcceptedDto,
} from './dto/auth-response.dto';
import type {
  LoginResponse,
  MeResponse,
  RegistrationAcceptedResponse,
} from './auth.service';

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
  ): Promise<ApiResponsePayload<RegistrationAcceptedResponse>> {
    return this.authService
      .registerCustomer(body)
      .then((result) =>
        ApiResponse.created(result, 'Dang ky tai khoan thanh cong.'),
      );
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
