import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader } from '@nestjs/swagger';

import {
  ApiResponse,
  type ApiResponsePayload,
  ReqContext,
  type RequestContext,
} from '../../common/http';
import {
  ApiCommonAuthErrors,
  ApiCommonMutationErrors,
  ApiCreatedEnvelope,
  ApiOkEnvelope,
} from '../../openapi/api-response.decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AccessTokenPayload } from '../auth/auth.types';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BookingService, type BookingResponse } from './booking.service';
import { BookingDto, ManagementBookingDto } from './dto/booking-response.dto';
import type { ManagementBookingResponse } from './booking.types';
import { CreateManagementBookingDto } from './dto/create-management-booking.dto';
import { ListManagementBookingsQueryDto } from './dto/list-management-bookings-query.dto';
import { UpdateBookingStatusDto } from './dto/update-booking-status.dto';

@Controller('v1/management/bookings')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'STAFF')
@ApiBearerAuth()
@ApiCommonAuthErrors()
export class BookingManagementController {
  constructor(private readonly bookingService: BookingService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedEnvelope(ManagementBookingDto)
  @ApiCommonMutationErrors()
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Optional request identity. Reusing it with the same counter-booking request replays the committed booking.',
  })
  create(
    @CurrentAuth() auth: AccessTokenPayload,
    @Headers('idempotency-key') requestIntentKey: string | undefined,
    @ReqContext() context: RequestContext,
    @Body() body: CreateManagementBookingDto,
  ): Promise<ApiResponsePayload<ManagementBookingResponse>> {
    return this.bookingService
      .createForManagement(
        auth.user_id,
        body,
        { requestId: context.requestId },
        requestIntentKey,
      )
      .then((booking) =>
        ApiResponse.created(booking, 'Tao booking tai quay thanh cong.'),
      );
  }

  @Get()
  @ApiOkEnvelope(BookingDto, { isArray: true, paginated: true })
  list(
    @Query() query: ListManagementBookingsQueryDto,
  ): Promise<ApiResponsePayload<BookingResponse[]>> {
    return this.bookingService
      .listManagement(query)
      .then((result) =>
        ApiResponse.ok(
          result.items,
          'Lay danh sach booking quan ly thanh cong.',
          result.meta,
        ),
      );
  }

  @Get(':id')
  @ApiOkEnvelope(ManagementBookingDto)
  getById(
    @Param('id') id: string,
  ): Promise<ApiResponsePayload<ManagementBookingResponse>> {
    return this.bookingService
      .getManagement(id)
      .then((booking) =>
        ApiResponse.ok(booking, 'Lay thong tin booking quan ly thanh cong.'),
      );
  }

  @Patch(':id/status')
  @ApiOkEnvelope(ManagementBookingDto)
  @ApiCommonMutationErrors()
  updateStatus(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @ReqContext() context: RequestContext,
    @Body() body: UpdateBookingStatusDto,
  ): Promise<ApiResponsePayload<ManagementBookingResponse>> {
    return this.bookingService
      .updateStatus(id, body, auth.user_id, {
        requestId: context.requestId,
      })
      .then((booking) =>
        ApiResponse.ok(booking, 'Cap nhat trang thai booking thanh cong.'),
      );
  }
}
