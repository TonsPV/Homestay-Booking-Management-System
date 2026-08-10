import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository, SelectQueryBuilder } from 'typeorm';

import type { PaginationMeta } from '../../common/http';
import { optionalSearch, parsePagination } from '../../common/validation';
import { CustomerCredentialPolicy } from '../customer/customer-credential.policy';
import { Payment, PaymentStatus } from '../payment/schema/payment.entity';
import { BookingTransitionPolicy } from './booking-transition.policy';
import type {
  BookingResponse,
  ManagementBookingResponse,
} from './booking.types';
import type { ListBookingsQueryDto } from './dto/list-bookings-query.dto';
import type { ListManagementBookingsQueryDto } from './dto/list-management-bookings-query.dto';
import { Booking, BookingStatus } from './schema/booking.entity';

export interface BookingListResult {
  items: BookingResponse[];
  meta: PaginationMeta;
}

@Injectable()
export class BookingQueryService {
  constructor(
    @InjectRepository(Booking)
    private readonly bookingsRepository: Repository<Booking>,
    @InjectRepository(Payment)
    private readonly paymentsRepository: Repository<Payment>,
    private readonly customerCredentialPolicy: CustomerCredentialPolicy,
    private readonly bookingTransitionPolicy: BookingTransitionPolicy,
  ) {}

  async listForCustomer(
    customerId: string | undefined,
    query: ListBookingsQueryDto,
  ): Promise<BookingListResult> {
    const activeCustomerId = this.requireActorId(customerId);
    const { page, limit, skip } = parsePagination(
      query as Record<string, unknown>,
    );
    const status = this.optionalBookingStatus(query.status);
    const bookingsQuery = this.createBookingQuery()
      .where('booking.customerId = :customerId', {
        customerId: activeCustomerId,
      })
      .orderBy('booking.createdAt', 'DESC')
      .addOrderBy('booking.id', 'DESC')
      .skip(skip)
      .take(limit);

    if (status !== undefined) {
      bookingsQuery.andWhere('booking.status = :status', { status });
    }

    return this.toListResult(bookingsQuery, page, limit);
  }

  async listManagement(
    query: ListManagementBookingsQueryDto,
  ): Promise<BookingListResult> {
    const { page, limit, skip } = parsePagination(
      query as Record<string, unknown>,
    );
    const status = this.optionalBookingStatus(query.status);
    const search = optionalSearch(query.search);
    const customerId = this.optionalId(
      query.customerId,
      'Customer id khong hop le.',
    );
    const roomId = this.optionalId(query.roomId, 'Room id khong hop le.');
    const bookingsQuery = this.createBookingQuery()
      .orderBy('booking.createdAt', 'DESC')
      .addOrderBy('booking.id', 'DESC')
      .skip(skip)
      .take(limit);

    if (status !== undefined) {
      bookingsQuery.andWhere('booking.status = :status', { status });
    }

    if (customerId !== undefined) {
      bookingsQuery.andWhere('booking.customerId = :customerId', {
        customerId,
      });
    }

    if (roomId !== undefined) {
      bookingsQuery.andWhere('booking.roomId = :roomId', { roomId });
    }

    if (search !== undefined) {
      bookingsQuery.andWhere(
        `(
          LOWER(booking.bookingCode) LIKE :search
          OR LOWER(booking.contactName) LIKE :search
          OR booking.contactPhone LIKE :phoneSearch
        )`,
        {
          search: `%${search.toLowerCase()}%`,
          phoneSearch: `%${search}%`,
        },
      );
    }

    return this.toListResult(bookingsQuery, page, limit);
  }

  async getForCustomer(
    customerId: string | undefined,
    id: string,
  ): Promise<BookingResponse> {
    const activeCustomerId = this.requireActorId(customerId);
    this.validateId(id, 'Booking id khong hop le.');

    const booking = await this.createBookingQuery()
      .where('booking.id = :id', { id })
      .andWhere('booking.customerId = :customerId', {
        customerId: activeCustomerId,
      })
      .getOne();

    if (booking === null) {
      throw new NotFoundException('Khong tim thay booking.');
    }

    return this.toResponse(booking);
  }

  async getManagement(id: string): Promise<ManagementBookingResponse> {
    this.validateId(id, 'Booking id khong hop le.');

    const booking = await this.createBookingQuery()
      .where('booking.id = :id', { id })
      .getOne();

    if (booking === null) {
      throw new NotFoundException('Khong tim thay booking.');
    }

    const [credentialCapabilities, refundPending] = await Promise.all([
      this.customerCredentialPolicy.evaluateByCustomerId(booking.customerId),
      this.paymentsRepository.existsBy({
        bookingId: booking.id,
        status: PaymentStatus.REFUND_PENDING,
      }),
    ]);

    return {
      ...this.toResponse(booking),
      credentialCapabilities,
      transitionCapabilities: this.bookingTransitionPolicy.getCapabilities(
        booking,
        {
          refundPending,
          roomExists: booking.room !== null,
          roomStatus: booking.room?.status,
        },
      ),
    };
  }

  private createBookingQuery(): SelectQueryBuilder<Booking> {
    // TypeORM decides whether to append relation deleted_at filters when a
    // join is registered, so withDeleted must precede the historical joins.
    return this.bookingsRepository
      .createQueryBuilder('booking')
      .withDeleted()
      .innerJoinAndSelect('booking.customer', 'customer')
      .innerJoinAndSelect('booking.room', 'room')
      .innerJoinAndSelect('room.roomType', 'roomType')
      .leftJoinAndSelect('booking.createdByUser', 'createdByUser');
  }

  private async toListResult(
    query: SelectQueryBuilder<Booking>,
    page: number,
    limit: number,
  ): Promise<BookingListResult> {
    const [bookings, total] = await query.getManyAndCount();

    return {
      items: bookings.map((booking) => this.toResponse(booking)),
      meta: {
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    };
  }

  private toResponse(booking: Booking): BookingResponse {
    return {
      id: booking.id,
      bookingCode: booking.bookingCode,
      customerId: booking.customerId,
      roomId: booking.roomId,
      createdByUserId: booking.createdByUserId,
      checkInDate: booking.checkInDate,
      checkOutDate: booking.checkOutDate,
      guestCount: booking.guestCount,
      contactName: booking.contactName,
      contactPhone: booking.contactPhone,
      contactEmail: booking.contactEmail,
      totalAmount: booking.totalAmount,
      status: booking.status,
      paymentStatus: booking.paymentStatus,
      paymentExpiresAt: booking.paymentExpiresAt,
      customerNote: booking.customerNote,
      cancelledAt: booking.cancelledAt,
      cancellationReason: booking.cancellationReason,
      customer: {
        id: booking.customer.id,
        fullName: booking.customer.fullName,
        phone: booking.customer.phone,
      },
      room: {
        id: booking.room.id,
        roomNumber: booking.room.roomNumber,
        name: booking.room.name,
        roomType: {
          id: booking.room.roomType.id,
          name: booking.room.roomType.name,
        },
      },
      createdByUser:
        booking.createdByUser === null
          ? null
          : {
              id: booking.createdByUser.id,
              fullName: booking.createdByUser.fullName,
            },
      createdAt: booking.createdAt,
      updatedAt: booking.updatedAt,
    };
  }

  private optionalBookingStatus(value: unknown): BookingStatus | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    if (
      typeof value !== 'string' ||
      !Object.values(BookingStatus).includes(value as BookingStatus)
    ) {
      throw new BadRequestException('Trang thai booking khong hop le.');
    }

    return value as BookingStatus;
  }

  private requireActorId(value: string | undefined): string {
    if (value === undefined || !/^[1-9][0-9]*$/.test(value)) {
      throw new UnauthorizedException('Access token is invalid.');
    }

    return value;
  }

  private optionalId(value: unknown, message: string): string | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    return this.requireId(value, message);
  }

  private requireId(value: unknown, message: string): string {
    if (typeof value !== 'string' && typeof value !== 'number') {
      throw new BadRequestException(message);
    }

    const id = String(value);

    if (!/^[1-9][0-9]*$/.test(id)) {
      throw new BadRequestException(message);
    }

    return id;
  }

  private validateId(id: string, message: string): void {
    this.requireId(id, message);
  }
}
