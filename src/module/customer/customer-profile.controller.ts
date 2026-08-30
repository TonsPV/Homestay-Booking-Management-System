import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiResponse, ApiResponsePayload } from '../../common/http';
import {
  ApiCommonAuthErrors,
  ApiCommonMutationErrors,
  ApiOkEnvelope,
} from '../../openapi/api-response.decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AccessTokenPayload } from '../auth/auth.types';
import { Actors } from '../auth/decorators/actors.decorator';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { ActorsGuard } from '../auth/guards/actors.guard';
import { AuthCustomerDto } from '../auth/dto/auth-response.dto';
import { CustomerProfileService } from './customer-profile.service';
import type { CustomerProfileResponse } from './customer-profile.service';
import { CustomerCredentialService } from './customer-credential.service';
import type { CustomerCredentialResult } from './customer-credential.service';
import { ChangeCustomerPasswordDto } from './dto/change-customer-password.dto';
import { CustomerCredentialResultDto } from './dto/customer-credential-response.dto';
import { UpdateCustomerProfileDto } from './dto/update-customer-profile.dto';

@Controller('v1/customers')
@UseGuards(JwtAuthGuard, ActorsGuard)
@Actors('customer')
@ApiTags('Customer Profile')
@ApiBearerAuth()
@ApiCommonAuthErrors()
export class CustomerProfileController {
  constructor(
    private readonly customerProfileService: CustomerProfileService,
    private readonly customerCredentialService: CustomerCredentialService,
  ) {}

  @Get('me')
  @ApiOkEnvelope(AuthCustomerDto)
  me(
    @CurrentAuth() auth: AccessTokenPayload,
  ): Promise<ApiResponsePayload<CustomerProfileResponse>> {
    return this.customerProfileService
      .getMe(auth.customer_id)
      .then((customer) =>
        ApiResponse.ok(customer, 'Lay thong tin customer thanh cong.'),
      );
  }

  @Patch('me')
  @ApiOkEnvelope(AuthCustomerDto)
  @ApiCommonMutationErrors()
  updateMe(
    @CurrentAuth() auth: AccessTokenPayload,
    @Body() body: UpdateCustomerProfileDto,
  ): Promise<ApiResponsePayload<CustomerProfileResponse>> {
    return this.customerProfileService
      .updateMe(auth.customer_id, body)
      .then((customer) =>
        ApiResponse.ok(customer, 'Cap nhat thong tin customer thanh cong.'),
      );
  }

  @Patch('me/password')
  @ApiOperation({
    summary: 'Change the authenticated Customer password and revoke old tokens',
  })
  @ApiOkEnvelope(CustomerCredentialResultDto)
  @ApiCommonMutationErrors()
  changePassword(
    @CurrentAuth() auth: AccessTokenPayload,
    @Body() body: ChangeCustomerPasswordDto,
  ): Promise<ApiResponsePayload<CustomerCredentialResult>> {
    return this.customerCredentialService
      .changeOwnPassword(auth.customer_id, body)
      .then((result) =>
        ApiResponse.ok(result, 'Cap nhat mat khau customer thanh cong.'),
      );
  }
}
