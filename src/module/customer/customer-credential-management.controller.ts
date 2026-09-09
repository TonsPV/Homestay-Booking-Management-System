import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiResponse, type ApiResponsePayload } from '../../common/http';
import { ReqContext, type RequestContext } from '../../common/http';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import type { AccessTokenPayload } from '../auth/auth.types';
import { AuditActorType } from '../audit/domain/audit-log';
import {
  ApiCommonAuthErrors,
  ApiCommonMutationErrors,
  ApiOkEnvelope,
} from '../../openapi/api-response.decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import {
  CustomerCredentialService,
  type CredentialResult,
} from './customer-credential.service';
import { CustomerCredentialResultDto } from './dto/customer-credential-response.dto';
import { SetInitialCustomerPasswordDto } from './dto/set-initial-customer-password.dto';

@Controller('v1/management/customers')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'STAFF')
@ApiTags('Management Customers')
@ApiBearerAuth()
@ApiCommonAuthErrors()
export class CustomerCredentialManagementController {
  constructor(private readonly credentialService: CustomerCredentialService) {}

  @Patch(':id/initial-password')
  @ApiOperation({
    summary: 'Set the first password for an eligible Customer',
  })
  @ApiOkEnvelope(CustomerCredentialResultDto)
  @ApiCommonMutationErrors()
  setInitialPassword(
    @CurrentAuth() auth: AccessTokenPayload,
    @ReqContext() context: RequestContext,
    @Param('id') id: string,
    @Body() body: SetInitialCustomerPasswordDto,
  ): Promise<ApiResponsePayload<CredentialResult>> {
    return this.credentialService
      .setInitialPassword(id, body, {
        actorType: AuditActorType.USER,
        actorId: auth.user_id ?? null,
        requestId: context.requestId,
      })
      .then((result) =>
        ApiResponse.ok(result, 'Tao mat khau customer thanh cong.'),
      );
  }
}
