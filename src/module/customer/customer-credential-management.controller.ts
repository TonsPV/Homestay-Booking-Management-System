import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import {
  ApiResponse,
  type ApiResponsePayload,
  Roles,
  RolesGuard,
} from '../../common/http';
import { AccessTokenGuard } from '../auth/access-token.guard';
import {
  CustomerCredentialService,
  type CustomerCredentialResult,
} from './customer-credential.service';
import { CustomerCredentialEnvelopeDto } from './dto/customer-credential-response.dto';
import { SetInitialCustomerPasswordDto } from './dto/set-initial-customer-password.dto';

@Controller('v1/management/customers')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('ADMIN', 'STAFF')
@ApiTags('Management Customers')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Authentication is required.' })
@ApiForbiddenResponse({ description: 'ADMIN or STAFF role is required.' })
export class CustomerCredentialManagementController {
  constructor(
    private readonly customerCredentialService: CustomerCredentialService,
  ) {}

  @Patch(':id/initial-password')
  @ApiOperation({
    summary: 'Set the first password for a counter-created Customer',
  })
  @ApiOkResponse({ type: CustomerCredentialEnvelopeDto })
  @ApiBadRequestResponse({ description: 'Customer id or password is invalid.' })
  @ApiNotFoundResponse({ description: 'Customer does not exist.' })
  @ApiConflictResponse({ description: 'Customer already has a password.' })
  setInitialPassword(
    @Param('id') id: string,
    @Body() body: SetInitialCustomerPasswordDto,
  ): Promise<ApiResponsePayload<CustomerCredentialResult>> {
    return this.customerCredentialService
      .setInitialPassword(id, body)
      .then((result) =>
        ApiResponse.ok(result, 'Tao mat khau customer thanh cong.'),
      );
  }
}
