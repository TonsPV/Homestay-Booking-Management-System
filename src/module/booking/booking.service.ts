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
    private readonly bookingCreationService: BookingCreationService,
    private readonly bookingLifecycleService: BookingLifecycleService,
    private readonly bookingQueryService: BookingQueryService,
  ) {}

  async createForCustomer(
    customerId: string | undefined,
    body: CreateBookingDto,
    context?: BookingAuditContext,
  ): Promise<BookingResponse> {
    const result = await this.bookingCreationService.createForCustomer(
      customerId,
      body,
      context,
    );

    return this.getForCustomer(result.customerId, result.bookingId);
  }

  async createForManagement(
    userId: string | undefined,
    body: CreateManagementBookingDto,
    context?: BookingAuditContext,
  ): Promise<ManagementBookingResponse> {
    const bookingId = await this.bookingCreationService.createForManagement(
      userId,
      body,
      context,
    );

    return this.getManagement(bookingId);
  }

  async listForCustomer(
    customerId: string | undefined,
    query: ListBookingsQueryDto,
  ): Promise<BookingListResult> {
    return this.bookingQueryService.listForCustomer(customerId, query);
  }

  async listManagement(
    query: ListManagementBookingsQueryDto,
  ): Promise<BookingListResult> {
    return this.bookingQueryService.listManagement(query);
  }

  async getForCustomer(
    customerId: string | undefined,
    id: string,
  ): Promise<BookingResponse> {
    return this.bookingQueryService.getForCustomer(customerId, id);
  }

  async getManagement(id: string): Promise<ManagementBookingResponse> {
    return this.bookingQueryService.getManagement(id);
  }

  async cancelForCustomer(
    customerId: string | undefined,
    id: string,
    body: CancelBookingDto,
    context?: BookingAuditContext,
  ): Promise<BookingResponse> {
    const activeCustomerId =
      await this.bookingLifecycleService.cancelForCustomer(
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
    await this.bookingLifecycleService.updateStatus(id, body, userId, context);

    return this.getManagement(id);
  }

  async expirePendingPayments(now = new Date()): Promise<number> {
    return this.bookingLifecycleService.expirePendingPayments(now);
  }
}
