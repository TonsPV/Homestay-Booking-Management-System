import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import {
  ApiResponse,
  type ApiResponsePayload,
  type AccessTokenPayload,
  CurrentAuth,
  Roles,
  RolesGuard,
} from '../../common/http';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { BookingService, type BookingResponse } from './booking.service';
import { CreateManagementBookingDto } from './dto/create-management-booking.dto';
import { ListManagementBookingsQueryDto } from './dto/list-management-bookings-query.dto';
import { UpdateBookingStatusDto } from './dto/update-booking-status.dto';

@Controller('v1/management/bookings')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('ADMIN', 'STAFF')
export class BookingManagementController {
  constructor(private readonly bookingService: BookingService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @CurrentAuth() auth: AccessTokenPayload,
    @Body() body: CreateManagementBookingDto,
  ): Promise<ApiResponsePayload<BookingResponse>> {
    return this.bookingService
      .createForManagement(auth.user_id, body)
      .then((booking) =>
        ApiResponse.created(booking, 'Tao booking tai quay thanh cong.'),
      );
  }

  @Get()
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
  getById(
    @Param('id') id: string,
  ): Promise<ApiResponsePayload<BookingResponse>> {
    return this.bookingService
      .getManagement(id)
      .then((booking) =>
        ApiResponse.ok(booking, 'Lay thong tin booking quan ly thanh cong.'),
      );
  }

  @Patch(':id/status')
  updateStatus(
    @Param('id') id: string,
    @Body() body: UpdateBookingStatusDto,
  ): Promise<ApiResponsePayload<BookingResponse>> {
    return this.bookingService
      .updateStatus(id, body)
      .then((booking) =>
        ApiResponse.ok(booking, 'Cap nhat trang thai booking thanh cong.'),
      );
  }
}
