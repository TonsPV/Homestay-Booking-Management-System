import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import {
  DataSource,
  type EntityManager,
  In,
  type Repository,
  type SelectQueryBuilder,
} from 'typeorm';

import { getMysqlDuplicateKey } from '../../common/database';
import type { PaginationMeta } from '../../common/http';
import {
  getVietnamesePhoneLookupVariants,
  optionalNullableEmail,
  optionalNullableTrimmedString,
  optionalSearch,
  optionalTrimmedString,
  parsePagination,
  requiredPhone,
  requirePositiveInt,
} from '../../common/validation';
import { Customer } from '../customer/schema/customer.entity';
import {
  Payment,
  PaymentMethod,
  PaymentStatus,
} from '../payment/schema/payment.entity';
import { Room, RoomStatus } from '../room/schema/room.entity';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { CreateBookingDto } from './dto/create-booking.dto';
import { CreateManagementBookingDto } from './dto/create-management-booking.dto';
import { ListBookingsQueryDto } from './dto/list-bookings-query.dto';
import { ListManagementBookingsQueryDto } from './dto/list-management-bookings-query.dto';
import { UpdateBookingStatusDto } from './dto/update-booking-status.dto';
import {
  Booking,
  BookingPaymentStatus,
  BookingStatus,
} from './schema/booking.entity';
import {
  RoomCalendar,
  RoomCalendarStatus,
} from './schema/room-calendar.entity';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const VIETNAM_UTC_OFFSET_MILLISECONDS = 7 * 60 * 60 * 1000;
const MAX_STAY_NIGHTS = 90;
const MAX_TOTAL_CENTS = 999_999_999_999n;

const MANAGEMENT_STATUS_TRANSITIONS: Record<
  BookingStatus,
  readonly BookingStatus[]
> = {
  [BookingStatus.PENDING_PAYMENT]: [
    BookingStatus.CONFIRMED,
    BookingStatus.CANCELLED,
  ],
  [BookingStatus.CONFIRMED]: [
    BookingStatus.CHECKED_IN,
    BookingStatus.CANCELLED,
  ],
  [BookingStatus.CHECKED_IN]: [BookingStatus.CHECKED_OUT],
  [BookingStatus.CHECKED_OUT]: [],
  [BookingStatus.CANCELLED]: [],
};

interface NormalizedCreateBookingInput {
  roomId: string;
  checkInDate: string;
  checkOutDate: string;
  nights: number;
  guestCount: number;
  contactName: string | undefined;
  contactPhone: string | undefined;
  contactEmail: string | null | undefined;
  customerNote: string | null;
}

interface BookingContact {
  name: string;
  phone: string;
  email: string | null;
}

interface BookingListResult {
  items: BookingResponse[];
  meta: PaginationMeta;
}

export interface BookingResponse {
  id: string;
  bookingCode: string;
  customerId: string;
  roomId: string;
  createdByUserId: string | null;
  checkInDate: string;
  checkOutDate: string;
  guestCount: number;
  contactName: string;
  contactPhone: string;
  contactEmail: string | null;
  totalAmount: string;
  status: BookingStatus;
  paymentStatus: BookingPaymentStatus;
  paymentExpiresAt: Date | null;
  customerNote: string | null;
  cancelledAt: Date | null;
  cancellationReason: string | null;
  customer: {
    id: string;
    fullName: string;
    phone: string;
  };
  room: {
    id: string;
    roomNumber: string;
    name: string;
    roomType: {
      id: string;
      name: string;
    };
  };
  createdByUser: {
    id: string;
    fullName: string;
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class BookingService {
  private readonly paymentTimeoutMilliseconds: number;

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Booking)
    private readonly bookingsRepository: Repository<Booking>,
    configService: ConfigService,
  ) {
    this.paymentTimeoutMilliseconds =
      configService.getOrThrow<number>('BOOKING_PAYMENT_TIMEOUT_MINUTES') *
      60 *
      1000;
  }

  async createForCustomer(
    customerId: string | undefined,
    body: CreateBookingDto,
  ): Promise<BookingResponse> {
    const activeCustomerId = this.requireActorId(customerId);
    const input = this.normalizeCreateInput(body);
    const bookingId = await this.createBookingInTransaction(
      input,
      async (manager) =>
        this.getActiveCustomer(manager, activeCustomerId, true),
      null,
    );

    return this.getForCustomer(activeCustomerId, bookingId);
  }

  async createForManagement(
    userId: string | undefined,
    body: CreateManagementBookingDto,
  ): Promise<BookingResponse> {
    const createdByUserId = this.requireActorId(userId);
    const input = this.normalizeCreateInput(body);
    const requestedCustomerId = this.optionalId(
      body.customerId,
      'Customer id khong hop le.',
    );
    const bookingId = await this.createBookingInTransaction(
      input,
      async (manager) =>
        this.resolveManagementCustomer(manager, requestedCustomerId, input),
      createdByUserId,
    );

    return this.getManagement(bookingId);
  }

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

  async getManagement(id: string): Promise<BookingResponse> {
    this.validateId(id, 'Booking id khong hop le.');

    const booking = await this.createBookingQuery()
      .where('booking.id = :id', { id })
      .getOne();

    if (booking === null) {
      throw new NotFoundException('Khong tim thay booking.');
    }

    return this.toResponse(booking);
  }

  async cancelForCustomer(
    customerId: string | undefined,
    id: string,
    body: CancelBookingDto,
  ): Promise<BookingResponse> {
    const activeCustomerId = this.requireActorId(customerId);
    this.validateId(id, 'Booking id khong hop le.');
    const reason =
      optionalNullableTrimmedString(
        body.reason,
        'Ly do huy booking khong hop le.',
        500,
      ) ?? null;

    await this.dataSource.transaction(async (manager) => {
      const booking = await this.getLockedBooking(manager, id);

      if (booking.customerId !== activeCustomerId) {
        throw new NotFoundException('Khong tim thay booking.');
      }

      await this.cancelBooking(manager, booking, reason, true);
    });

    return this.getForCustomer(activeCustomerId, id);
  }

  async updateStatus(
    id: string,
    body: UpdateBookingStatusDto,
  ): Promise<BookingResponse> {
    this.validateId(id, 'Booking id khong hop le.');
    const status = this.requireBookingStatus(body.status);
    const cancellationReason =
      optionalNullableTrimmedString(
        body.cancellationReason,
        'Ly do huy booking khong hop le.',
        500,
      ) ?? null;

    await this.dataSource.transaction(async (manager) => {
      const booking = await this.getLockedBooking(manager, id);

      if (booking.status === status) {
        return;
      }

      if (
        await manager.getRepository(Payment).existsBy({
          bookingId: booking.id,
          status: PaymentStatus.REFUND_PENDING,
        })
      ) {
        throw new ConflictException(
          'Booking dang co yeu cau hoan tien VNPay cho doi soat.',
        );
      }

      if (status === BookingStatus.CANCELLED) {
        await this.cancelBooking(manager, booking, cancellationReason, false);
        return;
      }

      if (!MANAGEMENT_STATUS_TRANSITIONS[booking.status].includes(status)) {
        throw new ConflictException(
          `Khong the chuyen booking tu ${booking.status} sang ${status}.`,
        );
      }

      if (
        status === BookingStatus.CONFIRMED &&
        booking.paymentStatus === BookingPaymentStatus.UNPAID &&
        booking.createdByUserId === null
      ) {
        throw new ConflictException(
          'Booking online chi duoc xac nhan sau khi thanh toan.',
        );
      }

      if (
        status === BookingStatus.CHECKED_IN &&
        booking.paymentStatus !== BookingPaymentStatus.PAID
      ) {
        throw new ConflictException(
          'Booking phai duoc thanh toan truoc khi check-in.',
        );
      }

      await this.applyRoomStayTransition(manager, booking, status);

      booking.status = status;
      booking.paymentExpiresAt = null;
      await manager.getRepository(Booking).save(booking);
    });

    return this.getManagement(id);
  }

  private async createBookingInTransaction(
    input: NormalizedCreateBookingInput,
    resolveCustomer: (manager: EntityManager) => Promise<Customer>,
    createdByUserId: string | null,
  ): Promise<string> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const customer = await resolveCustomer(manager);
        const room = await this.getBookableRoom(manager, input.roomId);

        if (input.guestCount > room.roomType.maxGuests) {
          throw new BadRequestException(
            'So luong khach vuot qua suc chua cua loai phong.',
          );
        }

        const contact = this.resolveContact(customer, input);
        const bookingsRepository = manager.getRepository(Booking);
        const booking = bookingsRepository.create({
          bookingCode: this.createBookingCode(),
          customerId: customer.id,
          roomId: room.id,
          createdByUserId,
          checkInDate: input.checkInDate,
          checkOutDate: input.checkOutDate,
          guestCount: input.guestCount,
          contactName: contact.name,
          contactPhone: contact.phone,
          contactEmail: contact.email,
          totalAmount: this.calculateTotalAmount(
            room.roomType.basePrice,
            input.nights,
          ),
          status: BookingStatus.PENDING_PAYMENT,
          paymentStatus: BookingPaymentStatus.UNPAID,
          paymentExpiresAt: new Date(
            Date.now() + this.paymentTimeoutMilliseconds,
          ),
          customerNote: input.customerNote,
          cancelledAt: null,
          cancellationReason: null,
        });
        const savedBooking = await bookingsRepository.save(booking);
        const calendarRepository = manager.getRepository(RoomCalendar);
        const calendarEntries = this.enumerateStayDates(
          input.checkInDate,
          input.checkOutDate,
        ).map((stayDate) =>
          calendarRepository.create({
            roomId: room.id,
            bookingId: savedBooking.id,
            stayDate,
            status: RoomCalendarStatus.RESERVED,
            reason: null,
          }),
        );

        await calendarRepository.insert(calendarEntries);

        return savedBooking.id;
      });
    } catch (error) {
      this.throwBookingWriteConflict(error);
    }
  }

  private async resolveManagementCustomer(
    manager: EntityManager,
    requestedCustomerId: string | undefined,
    input: NormalizedCreateBookingInput,
  ): Promise<Customer> {
    if (requestedCustomerId !== undefined) {
      return this.getActiveCustomer(manager, requestedCustomerId, false);
    }

    if (input.contactName === undefined || input.contactPhone === undefined) {
      throw new BadRequestException(
        'Contact name va contact phone la bat buoc khi tao khach tai quay.',
      );
    }

    const customersRepository = manager.getRepository(Customer);
    const existingCustomer = await customersRepository
      .createQueryBuilder('customer')
      .where('customer.deletedAt IS NULL')
      .andWhere('customer.phone IN (:...phones)', {
        phones: getVietnamesePhoneLookupVariants(input.contactPhone),
      })
      .getOne();

    if (existingCustomer !== null) {
      this.assertCustomerIsActive(existingCustomer);
      return existingCustomer;
    }

    if (input.contactEmail !== null && input.contactEmail !== undefined) {
      const existingEmail = await customersRepository.findOneBy({
        email: input.contactEmail,
      });

      if (existingEmail !== null) {
        throw new ConflictException('Email da duoc su dung.');
      }
    }

    return customersRepository.save(
      customersRepository.create({
        fullName: input.contactName,
        email: input.contactEmail ?? null,
        phone: input.contactPhone,
        passwordHash: null,
        status: 'ACTIVE',
      }),
    );
  }

  private async getActiveCustomer(
    manager: EntityManager,
    id: string,
    missingIsUnauthorized: boolean,
  ): Promise<Customer> {
    const customer = await manager.getRepository(Customer).findOneBy({ id });

    if (customer === null) {
      if (missingIsUnauthorized) {
        throw new UnauthorizedException('Access token is invalid.');
      }

      throw new NotFoundException('Khong tim thay customer.');
    }

    this.assertCustomerIsActive(customer);
    return customer;
  }

  private assertCustomerIsActive(customer: Customer): void {
    if (customer.status === 'LOCKED') {
      throw new ForbiddenException('Tai khoan bi khoa.');
    }
  }

  private async getBookableRoom(
    manager: EntityManager,
    id: string,
  ): Promise<Room> {
    const room = await manager
      .getRepository(Room)
      .createQueryBuilder('room')
      .innerJoinAndSelect('room.roomType', 'roomType')
      .setLock('pessimistic_write')
      .where('room.id = :id', { id })
      .andWhere('room.deletedAt IS NULL')
      .andWhere('roomType.deletedAt IS NULL')
      .getOne();

    if (room === null) {
      throw new NotFoundException('Khong tim thay phong.');
    }

    if (
      room.status === RoomStatus.HIDDEN ||
      room.status === RoomStatus.MAINTENANCE
    ) {
      throw new ConflictException('Phong hien khong the dat.');
    }

    return room;
  }

  private async getLockedBooking(
    manager: EntityManager,
    id: string,
  ): Promise<Booking> {
    const booking = await manager
      .getRepository(Booking)
      .createQueryBuilder('booking')
      .setLock('pessimistic_write')
      .where('booking.id = :id', { id })
      .getOne();

    if (booking === null) {
      throw new NotFoundException('Khong tim thay booking.');
    }

    return booking;
  }

  private async cancelBooking(
    manager: EntityManager,
    booking: Booking,
    reason: string | null,
    customerRequested: boolean,
  ): Promise<void> {
    if (booking.status === BookingStatus.CANCELLED) {
      return;
    }

    if (booking.paymentStatus === BookingPaymentStatus.PAID) {
      throw new ConflictException(
        'Booking da thanh toan. Can hoan tien truoc khi huy.',
      );
    }

    if (
      customerRequested &&
      booking.status !== BookingStatus.PENDING_PAYMENT &&
      booking.status !== BookingStatus.CONFIRMED
    ) {
      throw new ConflictException(
        'Customer khong the huy booking o trang thai hien tai.',
      );
    }

    if (
      !customerRequested &&
      !MANAGEMENT_STATUS_TRANSITIONS[booking.status].includes(
        BookingStatus.CANCELLED,
      )
    ) {
      throw new ConflictException(
        `Khong the huy booking o trang thai ${booking.status}.`,
      );
    }

    booking.status = BookingStatus.CANCELLED;
    booking.paymentExpiresAt = null;
    booking.cancelledAt = new Date();
    booking.cancellationReason = reason;

    await manager.getRepository(Booking).save(booking);
    await this.failPendingOnlinePayments(manager, [booking.id], 'CANCELLED');
    await manager.getRepository(RoomCalendar).delete({
      bookingId: booking.id,
    });
  }

  private createBookingQuery(): SelectQueryBuilder<Booking> {
    return this.bookingsRepository
      .createQueryBuilder('booking')
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

  private normalizeCreateInput(
    body: CreateBookingDto,
  ): NormalizedCreateBookingInput {
    const roomId = this.requireId(body.roomId, 'Room id khong hop le.');
    const checkInDate = this.requireIsoDate(
      body.checkInDate,
      'Ngay check-in khong hop le.',
    );
    const checkOutDate = this.requireIsoDate(
      body.checkOutDate,
      'Ngay check-out khong hop le.',
    );
    const nights = this.calculateNights(checkInDate, checkOutDate);

    if (checkInDate < this.getCurrentVietnamDate()) {
      throw new BadRequestException(
        'Ngay check-in khong duoc nam trong qua khu.',
      );
    }
    const guestCount = requirePositiveInt(
      body.guestCount,
      'So luong khach khong hop le.',
    );
    const contactName = optionalTrimmedString(
      body.contactName,
      'Ten nguoi lien he khong hop le.',
      120,
    );
    const contactPhone =
      body.contactPhone === undefined
        ? undefined
        : requiredPhone(body.contactPhone);
    const contactEmail = optionalNullableEmail(body.contactEmail);
    const customerNote =
      optionalNullableTrimmedString(
        body.customerNote,
        'Ghi chu booking khong hop le.',
        10000,
      ) ?? null;

    return {
      roomId,
      checkInDate,
      checkOutDate,
      nights,
      guestCount,
      contactName,
      contactPhone,
      contactEmail,
      customerNote,
    };
  }

  private resolveContact(
    customer: Customer,
    input: NormalizedCreateBookingInput,
  ): BookingContact {
    return {
      name: input.contactName ?? customer.fullName,
      phone: input.contactPhone ?? requiredPhone(customer.phone),
      email:
        input.contactEmail === undefined ? customer.email : input.contactEmail,
    };
  }

  private requireIsoDate(value: unknown, message: string): string {
    if (typeof value !== 'string') {
      throw new BadRequestException(message);
    }

    const date = value.trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);

    if (match === null) {
      throw new BadRequestException(message);
    }

    const parsed = new Date(`${date}T00:00:00.000Z`);

    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.getUTCFullYear() !== Number(match[1]) ||
      parsed.getUTCMonth() + 1 !== Number(match[2]) ||
      parsed.getUTCDate() !== Number(match[3])
    ) {
      throw new BadRequestException(message);
    }

    return date;
  }

  private calculateNights(checkInDate: string, checkOutDate: string): number {
    const checkIn = Date.parse(`${checkInDate}T00:00:00.000Z`);
    const checkOut = Date.parse(`${checkOutDate}T00:00:00.000Z`);
    const nights = (checkOut - checkIn) / MILLISECONDS_PER_DAY;

    if (!Number.isInteger(nights) || nights <= 0) {
      throw new BadRequestException('Ngay check-out phai sau ngay check-in.');
    }

    if (nights > MAX_STAY_NIGHTS) {
      throw new BadRequestException(
        `Booking khong duoc vuot qua ${MAX_STAY_NIGHTS} dem.`,
      );
    }

    return nights;
  }

  private enumerateStayDates(
    checkInDate: string,
    checkOutDate: string,
  ): string[] {
    const checkIn = Date.parse(`${checkInDate}T00:00:00.000Z`);
    const checkOut = Date.parse(`${checkOutDate}T00:00:00.000Z`);
    const stayDates: string[] = [];

    for (
      let stayDate = checkIn;
      stayDate < checkOut;
      stayDate += MILLISECONDS_PER_DAY
    ) {
      stayDates.push(new Date(stayDate).toISOString().slice(0, 10));
    }

    return stayDates;
  }

  private calculateTotalAmount(basePrice: string, nights: number): string {
    const match = /^([0-9]+)[.]([0-9]{2})$/.exec(basePrice);

    if (match === null) {
      throw new Error('Room type base price is invalid.');
    }

    const basePriceCents = BigInt(match[1]) * 100n + BigInt(match[2]);
    const totalCents = basePriceCents * BigInt(nights);

    if (totalCents > MAX_TOTAL_CENTS) {
      throw new ConflictException('Tong tien booking vuot qua gioi han.');
    }

    const wholeAmount = totalCents / 100n;
    const fractionalAmount = String(totalCents % 100n).padStart(2, '0');

    return `${wholeAmount}.${fractionalAmount}`;
  }

  private createBookingCode(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = randomBytes(6).toString('hex').toUpperCase();

    return `BK${timestamp}${random}`;
  }

  private async applyRoomStayTransition(
    manager: EntityManager,
    booking: Booking,
    nextStatus: BookingStatus,
  ): Promise<void> {
    if (
      nextStatus !== BookingStatus.CHECKED_IN &&
      nextStatus !== BookingStatus.CHECKED_OUT
    ) {
      return;
    }

    const currentDate = this.getCurrentVietnamDate();

    if (
      nextStatus === BookingStatus.CHECKED_IN &&
      (currentDate < booking.checkInDate || currentDate >= booking.checkOutDate)
    ) {
      throw new ConflictException(
        'Chi co the check-in trong thoi gian luu tru cua booking.',
      );
    }

    const room = await manager
      .getRepository(Room)
      .createQueryBuilder('room')
      .setLock('pessimistic_write')
      .where('room.id = :roomId', { roomId: booking.roomId })
      .andWhere('room.deletedAt IS NULL')
      .getOne();

    if (room === null) {
      throw new ConflictException('Phong cua booking khong con ton tai.');
    }

    if (nextStatus === BookingStatus.CHECKED_IN) {
      if (room.status !== RoomStatus.READY) {
        throw new ConflictException(
          'Phong phai o trang thai READY truoc khi check-in.',
        );
      }

      room.status = RoomStatus.OCCUPIED;
    } else if (
      room.status !== RoomStatus.HIDDEN &&
      room.status !== RoomStatus.MAINTENANCE
    ) {
      room.status = RoomStatus.CLEANING;
    }

    await manager.getRepository(Room).save(room);
  }

  async expirePendingPayments(now = new Date()): Promise<number> {
    return this.dataSource.transaction(async (manager) => {
      const bookingsRepository = manager.getRepository(Booking);
      const legacyCutoff = new Date(
        now.getTime() - this.paymentTimeoutMilliseconds,
      );
      const expiredBookings = await bookingsRepository
        .createQueryBuilder('booking')
        .setLock('pessimistic_write')
        .where('booking.status = :status', {
          status: BookingStatus.PENDING_PAYMENT,
        })
        .andWhere('booking.paymentStatus = :paymentStatus', {
          paymentStatus: BookingPaymentStatus.UNPAID,
        })
        .andWhere(
          `(
            booking.paymentExpiresAt <= :now
            OR (
              booking.paymentExpiresAt IS NULL
              AND booking.createdAt <= :legacyCutoff
            )
          )`,
          { now, legacyCutoff },
        )
        .orderBy('booking.id', 'ASC')
        .take(100)
        .getMany();

      if (expiredBookings.length === 0) {
        return 0;
      }

      const bookingIds = expiredBookings.map((booking) => booking.id);

      for (const booking of expiredBookings) {
        booking.status = BookingStatus.CANCELLED;
        booking.paymentExpiresAt = null;
        booking.cancelledAt = now;
        booking.cancellationReason = 'Payment expired.';
      }

      await bookingsRepository.save(expiredBookings);
      await this.failPendingOnlinePayments(manager, bookingIds, 'EXPIRED');
      await manager.getRepository(RoomCalendar).delete({
        bookingId: In(bookingIds),
      });

      return expiredBookings.length;
    });
  }

  private async failPendingOnlinePayments(
    manager: EntityManager,
    bookingIds: string[],
    responseCode: 'CANCELLED' | 'EXPIRED',
  ): Promise<void> {
    if (bookingIds.length === 0) {
      return;
    }

    await manager
      .getRepository(Payment)
      .createQueryBuilder()
      .update(Payment)
      .set({
        status: PaymentStatus.FAILED,
        gatewayResponseCode: responseCode,
      })
      .where('booking_id IN (:...bookingIds)', { bookingIds })
      .andWhere('method = :method', { method: PaymentMethod.VNPAY })
      .andWhere('status = :status', { status: PaymentStatus.PENDING })
      .execute();
  }

  private getCurrentVietnamDate(now = new Date()): string {
    return new Date(now.getTime() + VIETNAM_UTC_OFFSET_MILLISECONDS)
      .toISOString()
      .slice(0, 10);
  }

  private requireBookingStatus(value: unknown): BookingStatus {
    const status = this.optionalBookingStatus(value);

    if (status === undefined) {
      throw new BadRequestException('Trang thai booking khong hop le.');
    }

    return status;
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

  private optionalId(value: unknown, message: string): string | undefined {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }

    return this.requireId(value, message);
  }

  private validateId(id: string, message: string): void {
    this.requireId(id, message);
  }

  private throwBookingWriteConflict(error: unknown): never {
    const duplicateKey = getMysqlDuplicateKey(error);

    if (duplicateKey === undefined) {
      throw error;
    }

    if (duplicateKey.includes('room_calendar_room_date')) {
      throw new ConflictException(
        'Phong da duoc dat hoac bi khoa trong khoang ngay nay.',
      );
    }

    if (duplicateKey.includes('customers_phone')) {
      throw new ConflictException('So dien thoai da duoc su dung.');
    }

    if (duplicateKey.includes('customers_email')) {
      throw new ConflictException('Email da duoc su dung.');
    }

    throw new ConflictException('Khong the tao booking do du lieu bi trung.');
  }
}
