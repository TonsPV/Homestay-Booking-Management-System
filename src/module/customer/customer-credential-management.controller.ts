import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  ApiResponse,
  type ApiResponsePayload,
} from '../../common/http';
import {
  ApiCommonAuthErrors,
  ApiCommonMutationErrors,
  ApiOkEnvelope,
} from '../../openapi/api-response.decorators';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  CustomerCredentialService,
  type CustomerCredentialResult,
} from './customer-credential.service';
import { CustomerCredentialResultDto } from './dto/customer-credential-response.dto';
import { SetInitialCustomerPasswordDto } from './dto/set-initial-customer-password.dto';

@Controller('v1/management/customers')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('ADMIN', 'STAFF')
@ApiTags('Management Customers')
@ApiBearerAuth()
@ApiCommonAuthErrors()
export class CustomerCredentialManagementController {
  constructor(
    private readonly customerCredentialService: CustomerCredentialService,
  ) {}

  @Patch(':id/initial-password')
  @ApiOperation({
    summary: 'Set the first password for an eligible Customer',
  })
  @ApiOkEnvelope(CustomerCredentialResultDto)
  @ApiCommonMutationErrors()
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
