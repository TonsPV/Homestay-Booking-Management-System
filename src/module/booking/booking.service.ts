import { Injectable } from '@nestjs/common';

import { BookingCreationService } from './booking-creation.service';
import { BookingLifecycleService } from './booking-lifecycle.service';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import {
  BookingQueryService,
  type BookingListResult,
} from './booking-query.service';
import type {
  BookingAuditContext,
  BookingResponse,
  ManagementBookingResponse,
} from './booking.types';
import { CreateBookingDto } from './dto/create-booking.dto';
import { CreateManagementBookingDto } from './dto/create-management-booking.dto';
import { ListBookingsQueryDto } from './dto/list-bookings-query.dto';
import { ListManagementBookingsQueryDto } from './dto/list-management-bookings-query.dto';
import { UpdateBookingStatusDto } from './dto/update-booking-status.dto';
export type { BookingResponse } from './booking.types';

@Injectable()
export class BookingService {
  constructor(
    private readonly creation: BookingCreationService,
    private readonly lifecycle: BookingLifecycleService,
    private readonly query: BookingQueryService,
  ) {}

  async createForCustomer(
    customerId: string | undefined,
    body: CreateBookingDto,
    context?: BookingAuditContext,
    requestIntentKey?: string,
  ): Promise<BookingResponse> {
    const result = await this.creation.createForCustomer(
      customerId,
      body,
      context,
      requestIntentKey,
    );

    return this.getForCustomer(result.customerId, result.bookingId);
  }

  async createForManagement(
    userId: string | undefined,
    body: CreateManagementBookingDto,
    context?: BookingAuditContext,
    requestIntentKey?: string,
  ): Promise<ManagementBookingResponse> {
    const bookingId = await this.creation.createForManagement(
      userId,
      body,
      context,
      requestIntentKey,
    );

    return this.getManagement(bookingId);
  }

  async listForCustomer(
    customerId: string | undefined,
    query: ListBookingsQueryDto,
  ): Promise<BookingListResult> {
    return this.query.listForCustomer(customerId, query);
  }

  async listManagement(
    query: ListManagementBookingsQueryDto,
  ): Promise<BookingListResult> {
    return this.query.listManagement(query);
  }

  async getForCustomer(
    customerId: string | undefined,
    id: string,
  ): Promise<BookingResponse> {
    return this.query.getForCustomer(customerId, id);
  }

  async getManagement(id: string): Promise<ManagementBookingResponse> {
    return this.query.getManagement(id);
  }

  async cancelForCustomer(
    customerId: string | undefined,
    id: string,
    body: CancelBookingDto,
    context?: BookingAuditContext,
  ): Promise<BookingResponse> {
    const activeCustomerId = await this.lifecycle.cancelForCustomer(
      customerId,
      id,
      body,
      context,
    );

    return this.getForCustomer(activeCustomerId, id);
  }

  async updateStatus(
    id: string,
    body: UpdateBookingStatusDto,
    userId?: string,
    context?: BookingAuditContext,
  ): Promise<ManagementBookingResponse> {
    await this.lifecycle.updateStatus(id, body, userId, context);

    return this.getManagement(id);
  }

  async expireUnpaidBookings(now = new Date()): Promise<number> {
    return this.lifecycle.expireUnpaidBookings(now);
  }
}
