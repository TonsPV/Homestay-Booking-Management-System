import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';

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
import { UpdateCustomerProfileDto } from './dto/update-customer-profile.dto';

@Controller('v1/customers')
@UseGuards(AccessTokenGuard, ActorsGuard)
@Actors('customer')
export class CustomerProfileController {
  constructor(
    private readonly customerProfileService: CustomerProfileService,
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
}
