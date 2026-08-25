import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBadRequestResponse, ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import {
  ApiResponse,
  type ApiResponsePayload,
} from '../../common/http';
import {
  ApiCommonAuthErrors,
  ApiOkEnvelope,
} from '../../openapi/api-response.decorators';
import { ErrorEnvelopeDto } from '../../openapi/response-envelope.dto';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { DashboardQueryService } from './dashboard-query.service';
import { DashboardSummaryQueryDto } from './dto/dashboard-summary-query.dto';
import { DashboardSummaryResponse } from './dto/dashboard-summary.response';

@ApiTags('Management Dashboard')
@ApiBearerAuth()
@Controller('v1/management/dashboard')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('ADMIN', 'STAFF')
@ApiCommonAuthErrors()
export class DashboardController {
  constructor(private readonly dashboardQueryService: DashboardQueryService) {}

  @Get('summary')
  @ApiOkEnvelope(DashboardSummaryResponse)
  @ApiBadRequestResponse({
    description: 'The dashboard date range is invalid.',
    type: ErrorEnvelopeDto,
  })
  getSummary(
    @Query() query: DashboardSummaryQueryDto,
  ): Promise<ApiResponsePayload<DashboardSummaryResponse>> {
    return this.dashboardQueryService
      .getSummary(query)
      .then((summary) =>
        ApiResponse.ok(summary, 'Lay tong quan dashboard thanh cong.'),
      );
  }
}
