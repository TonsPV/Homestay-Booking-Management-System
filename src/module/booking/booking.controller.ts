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
import { AccessTokenGuard } from '../auth/access-token.guard';
import type { AccessTokenPayload } from '../auth/auth.types';
import { Actors } from '../auth/decorators/actors.decorator';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { ActorsGuard } from '../auth/guards/actors.guard';
import { BookingService, type BookingResponse } from './booking.service';
import { BookingDto } from './dto/booking-response.dto';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { ListBookingsQueryDto } from './dto/list-bookings-query.dto';

@Controller('v1/bookings')
@UseGuards(AccessTokenGuard, ActorsGuard)
@Actors('customer')
@ApiBearerAuth()
@ApiCommonAuthErrors()
export class BookingController {
  constructor(private readonly bookingService: BookingService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedEnvelope(BookingDto)
  @ApiCommonMutationErrors()
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Optional request identity. Reusing it with the same booking request replays the committed booking.',
  })
  create(
    @CurrentAuth() auth: AccessTokenPayload,
    @Headers('idempotency-key') requestIntentKey: string | undefined,
    @ReqContext() context: RequestContext,
    @Body() body: CreateBookingDto,
  ): Promise<ApiResponsePayload<BookingResponse>> {
    return this.bookingService
      .createForCustomer(
        auth.customer_id,
        body,
        { requestId: context.requestId },
        requestIntentKey,
      )
      .then((booking) =>
        ApiResponse.created(booking, 'Tao booking thanh cong.'),
      );
  }

  @Get()
  @ApiOkEnvelope(BookingDto, { isArray: true, paginated: true })
  list(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query() query: ListBookingsQueryDto,
  ): Promise<ApiResponsePayload<BookingResponse[]>> {
    return this.bookingService
      .listForCustomer(auth.customer_id, query)
      .then((result) =>
        ApiResponse.ok(
          result.items,
          'Lay danh sach booking thanh cong.',
          result.meta,
        ),
      );
  }

  @Get(':id')
  @ApiOkEnvelope(BookingDto)
  getById(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
  ): Promise<ApiResponsePayload<BookingResponse>> {
    return this.bookingService
      .getForCustomer(auth.customer_id, id)
      .then((booking) =>
        ApiResponse.ok(booking, 'Lay thong tin booking thanh cong.'),
      );
  }

  @Patch(':id/cancel')
  @ApiOkEnvelope(BookingDto)
  @ApiCommonMutationErrors()
  cancel(
    @CurrentAuth() auth: AccessTokenPayload,
    @Param('id') id: string,
    @ReqContext() context: RequestContext,
    @Body() body: CancelBookingDto,
  ): Promise<ApiResponsePayload<BookingResponse>> {
    return this.bookingService
      .cancelForCustomer(auth.customer_id, id, body, {
        requestId: context.requestId,
      })
      .then((booking) => ApiResponse.ok(booking, 'Huy booking thanh cong.'));
  }
}
