import {
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { DataSource, type EntityManager } from 'typeorm';

import { getMysqlDuplicateKey } from '../../common/database';
import { AppHttpException, ErrorCode } from '../../common/http';
import {
  getVietnamesePhoneLookupVariants,
  optionalNullableEmail,
  optionalNullableTrimmedString,
  optionalTrimmedString,
  requiredPhone,
  requirePositiveInt,
} from '../../common/validation';
import { Customer } from '../customer/schema/customer.entity';
import { Room, RoomStatus } from '../room/schema/room.entity';
import { CreateBookingDto } from './dto/create-booking.dto';
import { CreateManagementBookingDto } from './dto/create-management-booking.dto';
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

export interface CustomerBookingCreationResult {
  customerId: string;
  bookingId: string;
}

@Injectable()
export class BookingCreationService {
  private readonly paymentTimeoutMilliseconds: number;
  private readonly maxActiveUnpaidBookingsPerCustomer: number;
  private readonly maxHeldNightsPerCustomer: number;
  private readonly maxAdvanceBookingDays: number;

  constructor(
    private readonly dataSource: DataSource,
    configService: ConfigService,
  ) {
    this.paymentTimeoutMilliseconds =
      configService.getOrThrow<number>('BOOKING_PAYMENT_TIMEOUT_MINUTES') *
      60 *
      1000;
    this.maxActiveUnpaidBookingsPerCustomer = configService.getOrThrow<number>(
      'BOOKING_MAX_ACTIVE_UNPAID_PER_CUSTOMER',
    );
    this.maxHeldNightsPerCustomer = configService.getOrThrow<number>(
      'BOOKING_MAX_HELD_NIGHTS_PER_CUSTOMER',
    );
    this.maxAdvanceBookingDays = configService.getOrThrow<number>(
      'BOOKING_MAX_ADVANCE_DAYS',
    );
  }

  async createForCustomer(
    customerId: string | undefined,
    body: CreateBookingDto,
  ): Promise<CustomerBookingCreationResult> {
    const activeCustomerId = this.requireActorId(customerId);
    const input = this.normalizeCreateInput(body);
    const bookingId = await this.createBookingInTransaction(
      input,
      async (manager) =>
        this.getActiveCustomer(manager, activeCustomerId, true, true),
      null,
      true,
    );

    return { customerId: activeCustomerId, bookingId };
  }

  async createForManagement(
    userId: string | undefined,
    body: CreateManagementBookingDto,
  ): Promise<string> {
    const createdByUserId = this.requireActorId(userId);
    const input = this.normalizeCreateInput(body);
    const requestedCustomerId = this.optionalId(
      body.customerId,
      'Customer id khong hop le.',
    );

    return this.createBookingInTransaction(
      input,
      async (manager) =>
        this.resolveManagementCustomer(manager, requestedCustomerId, input),
      createdByUserId,
      false,
    );
  }

  private async createBookingInTransaction(
    input: NormalizedCreateBookingInput,
    resolveCustomer: (manager: EntityManager) => Promise<Customer>,
    createdByUserId: string | null,
    enforceCustomerAdmission: boolean,
  ): Promise<string> {
    try {
      return await this.dataSource.transaction(async (manager) => {
        const customer = await resolveCustomer(manager);

        if (enforceCustomerAdmission) {
          await this.assertCustomerBookingAdmission(
            manager,
            customer.id,
            input.nights,
          );
        }

        const room = await this.getBookableRoom(manager, input.roomId);

        if (input.guestCount > room.roomType.maxGuests) {
          throw new AppHttpException(
            HttpStatus.BAD_REQUEST,
            ErrorCode.BOOKING_GUEST_CAPACITY_EXCEEDED,
            'So luong khach vuot qua suc chua cua loai phong.',
            {
              fieldErrors: {
                guestCount: [
                  {
                    errorCode: ErrorCode.BOOKING_GUEST_CAPACITY_EXCEEDED,
                    message: 'So luong khach vuot qua suc chua cua loai phong.',
                  },
                ],
              },
            },
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
      return this.getActiveCustomer(manager, requestedCustomerId, false, false);
    }

    if (input.contactName === undefined || input.contactPhone === undefined) {
      throw new AppHttpException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BOOKING_CUSTOMER_CONTACT_REQUIRED,
        'Contact name va contact phone la bat buoc khi tao khach tai quay.',
        {
          fieldErrors: {
            contactName: [
              {
                errorCode: ErrorCode.BOOKING_CUSTOMER_CONTACT_REQUIRED,
                message: 'Ten khach tai quay la bat buoc.',
              },
            ],
            contactPhone: [
              {
                errorCode: ErrorCode.BOOKING_CUSTOMER_CONTACT_REQUIRED,
                message: 'So dien thoai khach tai quay la bat buoc.',
              },
            ],
          },
        },
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
        throw new AppHttpException(
          HttpStatus.CONFLICT,
          ErrorCode.CUSTOMER_EMAIL_IN_USE,
          'Email da duoc su dung.',
          {
            fieldErrors: {
              contactEmail: [
                {
                  errorCode: ErrorCode.CUSTOMER_EMAIL_IN_USE,
                  message: 'Email da duoc su dung.',
                },
              ],
            },
          },
        );
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
    lockForBookingAdmission: boolean,
  ): Promise<Customer> {
    const query = manager
      .getRepository(Customer)
      .createQueryBuilder('customer')
      .where('customer.id = :id', { id });

    if (lockForBookingAdmission) {
      query.setLock('pessimistic_write');
    }

    const customer = await query.getOne();

    if (customer === null) {
      if (missingIsUnauthorized) {
        throw new UnauthorizedException('Access token is invalid.');
      }

      throw new NotFoundException('Khong tim thay customer.');
    }

    this.assertCustomerIsActive(customer);
    return customer;
  }

  private async assertCustomerBookingAdmission(
    manager: EntityManager,
    customerId: string,
    requestedNights: number,
  ): Promise<void> {
    const bookingsRepository = manager.getRepository(Booking);
    const activeUnpaidWhere = {
      customerId,
      status: BookingStatus.PENDING_PAYMENT,
      paymentStatus: BookingPaymentStatus.UNPAID,
    };
    const activeUnpaidCount =
      await bookingsRepository.countBy(activeUnpaidWhere);

    if (activeUnpaidCount >= this.maxActiveUnpaidBookingsPerCustomer) {
      throw new AppHttpException(
        HttpStatus.CONFLICT,
        ErrorCode.BOOKING_ACTIVE_UNPAID_LIMIT_REACHED,
        `Ban dang co toi da ${this.maxActiveUnpaidBookingsPerCustomer} booking cho thanh toan. Vui long thanh toan, huy hoac cho booking het han.`,
        { details: { limit: this.maxActiveUnpaidBookingsPerCustomer } },
      );
    }

    const activeUnpaidBookings = await bookingsRepository.find({
      select: {
        checkInDate: true,
        checkOutDate: true,
      },
      where: activeUnpaidWhere,
    });
    const heldNights = activeUnpaidBookings.reduce(
      (total, booking) =>
        total + this.calculateNights(booking.checkInDate, booking.checkOutDate),
      0,
    );

    if (heldNights + requestedNights > this.maxHeldNightsPerCustomer) {
      throw new AppHttpException(
        HttpStatus.CONFLICT,
        ErrorCode.BOOKING_HELD_NIGHTS_LIMIT_REACHED,
        `Tong so dem dang giu va booking moi khong duoc vuot qua ${this.maxHeldNightsPerCustomer} dem.`,
        { details: { limit: this.maxHeldNightsPerCustomer } },
      );
    }
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
      throw new AppHttpException(
        HttpStatus.NOT_FOUND,
        ErrorCode.BOOKING_ROOM_NOT_FOUND,
        'Khong tim thay phong.',
        {
          fieldErrors: {
            roomId: [
              {
                errorCode: ErrorCode.BOOKING_ROOM_NOT_FOUND,
                message: 'Khong tim thay phong.',
              },
            ],
          },
        },
      );
    }

    if (
      room.status === RoomStatus.HIDDEN ||
      room.status === RoomStatus.MAINTENANCE
    ) {
      throw new AppHttpException(
        HttpStatus.CONFLICT,
        ErrorCode.BOOKING_ROOM_NOT_BOOKABLE,
        'Phong hien khong the dat.',
        {
          fieldErrors: {
            roomId: [
              {
                errorCode: ErrorCode.BOOKING_ROOM_NOT_BOOKABLE,
                message: 'Phong hien khong the dat.',
              },
            ],
          },
        },
      );
    }

    return room;
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

    const currentVietnamDate = this.getCurrentVietnamDate();

    if (checkInDate < currentVietnamDate) {
      throw new AppHttpException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BOOKING_CHECKIN_IN_PAST,
        'Ngay check-in khong duoc nam trong qua khu.',
        {
          fieldErrors: {
            checkInDate: [
              {
                errorCode: ErrorCode.BOOKING_CHECKIN_IN_PAST,
                message: 'Ngay check-in khong duoc nam trong qua khu.',
              },
            ],
          },
        },
      );
    }

    if (
      this.calculateDateDistance(currentVietnamDate, checkInDate) >
      this.maxAdvanceBookingDays
    ) {
      throw new AppHttpException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BOOKING_CHECKIN_TOO_FAR,
        `Ngay check-in khong duoc qua ${this.maxAdvanceBookingDays} ngay ke tu hom nay.`,
        {
          details: { maxAdvanceDays: this.maxAdvanceBookingDays },
          fieldErrors: {
            checkInDate: [
              {
                errorCode: ErrorCode.BOOKING_CHECKIN_TOO_FAR,
                message: 'Ngay check-in vuot qua thoi gian dat truoc.',
              },
            ],
          },
        },
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
    const nights = this.calculateDateDistance(checkInDate, checkOutDate);

    if (!Number.isInteger(nights) || nights <= 0) {
      throw new AppHttpException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BOOKING_DATE_RANGE_INVALID,
        'Ngay check-out phai sau ngay check-in.',
        {
          fieldErrors: {
            checkOutDate: [
              {
                errorCode: ErrorCode.BOOKING_DATE_RANGE_INVALID,
                message: 'Ngay check-out phai sau ngay check-in.',
              },
            ],
          },
        },
      );
    }

    if (nights > MAX_STAY_NIGHTS) {
      throw new AppHttpException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BOOKING_STAY_TOO_LONG,
        `Booking khong duoc vuot qua ${MAX_STAY_NIGHTS} dem.`,
        {
          details: { maxStayNights: MAX_STAY_NIGHTS },
          fieldErrors: {
            checkOutDate: [
              {
                errorCode: ErrorCode.BOOKING_STAY_TOO_LONG,
                message: `Booking khong duoc vuot qua ${MAX_STAY_NIGHTS} dem.`,
              },
            ],
          },
        },
      );
    }

    return nights;
  }

  private calculateDateDistance(fromDate: string, toDate: string): number {
    const from = Date.parse(`${fromDate}T00:00:00.000Z`);
    const to = Date.parse(`${toDate}T00:00:00.000Z`);

    return (to - from) / MILLISECONDS_PER_DAY;
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
      throw new AppHttpException(
        HttpStatus.CONFLICT,
        ErrorCode.BOOKING_TOTAL_LIMIT_EXCEEDED,
        'Tong tien booking vuot qua gioi han.',
      );
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

  private getCurrentVietnamDate(now = new Date()): string {
    return new Date(now.getTime() + VIETNAM_UTC_OFFSET_MILLISECONDS)
      .toISOString()
      .slice(0, 10);
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

  private throwBookingWriteConflict(error: unknown): never {
    const duplicateKey = getMysqlDuplicateKey(error);

    if (duplicateKey === undefined) {
      throw error;
    }

    if (duplicateKey.includes('room_calendar_room_date')) {
      throw new AppHttpException(
        HttpStatus.CONFLICT,
        ErrorCode.BOOKING_ROOM_UNAVAILABLE,
        'Phong da duoc dat hoac bi khoa trong khoang ngay nay.',
        {
          fieldErrors: {
            roomId: [
              {
                errorCode: ErrorCode.BOOKING_ROOM_UNAVAILABLE,
                message: 'Phong khong con trong trong khoang ngay nay.',
              },
            ],
          },
        },
      );
    }

    if (duplicateKey.includes('customers_phone')) {
      throw new AppHttpException(
        HttpStatus.CONFLICT,
        ErrorCode.CUSTOMER_PHONE_IN_USE,
        'So dien thoai da duoc su dung.',
        {
          fieldErrors: {
            contactPhone: [
              {
                errorCode: ErrorCode.CUSTOMER_PHONE_IN_USE,
                message: 'So dien thoai da duoc su dung.',
              },
            ],
          },
        },
      );
    }

    if (duplicateKey.includes('customers_email')) {
      throw new AppHttpException(
        HttpStatus.CONFLICT,
        ErrorCode.CUSTOMER_EMAIL_IN_USE,
        'Email da duoc su dung.',
        {
          fieldErrors: {
            contactEmail: [
              {
                errorCode: ErrorCode.CUSTOMER_EMAIL_IN_USE,
                message: 'Email da duoc su dung.',
              },
            ],
          },
        },
      );
    }

    throw new AppHttpException(
      HttpStatus.CONFLICT,
      ErrorCode.BOOKING_CREATE_CONFLICT,
      'Khong the tao booking do du lieu bi trung.',
    );
  }
}
