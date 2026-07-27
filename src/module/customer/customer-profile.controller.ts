import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import {
  Actors,
  ActorsGuard,
  ApiResponse,
  ApiResponsePayload,
  CurrentAuth,
  type AccessTokenPayload,
} from '../../common/http';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CustomerProfileService } from './customer-profile.service';
import type { CustomerProfileResponse } from './customer-profile.service';
import { CustomerCredentialService } from './customer-credential.service';
import type { CustomerCredentialResult } from './customer-credential.service';
import { ChangeCustomerPasswordDto } from './dto/change-customer-password.dto';
import { CustomerCredentialEnvelopeDto } from './dto/customer-credential-response.dto';
import { UpdateCustomerProfileDto } from './dto/update-customer-profile.dto';

@Controller('v1/customers')
@UseGuards(AccessTokenGuard, ActorsGuard)
@Actors('customer')
@ApiTags('Customer Profile')
@ApiBearerAuth()
export class CustomerProfileController {
  constructor(
    private readonly customerProfileService: CustomerProfileService,
    private readonly customerCredentialService: CustomerCredentialService,
  ) {}

  @Get('me')
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
  @ApiOkResponse({ type: CustomerCredentialEnvelopeDto })
  @ApiBadRequestResponse({
    description: 'Current password or new password is invalid.',
  })
  @ApiUnauthorizedResponse({ description: 'Customer token is invalid.' })
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
