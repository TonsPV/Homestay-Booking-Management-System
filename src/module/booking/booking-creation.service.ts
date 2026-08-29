import {
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { randomBytes } from 'node:crypto';

import {
  type TransactionContext,
  TransactionRunner,
} from '../../common/application/transaction';
import { ErrorCode } from '../../common/error-codes';
import { AppHttpException } from '../../common/http/app-http-exception';
import {
  getVietnamesePhoneLookupVariants,
  isValidIdempotencyKey,
  optionalNullableEmail,
  optionalNullableTrimmedString,
  optionalTrimmedString,
  requiredPhone,
  requirePositiveInt,
  requireTrimmedString,
} from '../../common/validation';
import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
} from '../audit/domain/audit-log';
import { TransactionalAuditLog } from '../audit/ports/transactional-audit-log';
import { Customer } from '../customer/schema/customer.entity';
import { Room } from '../room/schema/room.entity';
import { RoomStatus } from '../room/domain/room-status';
import { throwMappedBookingDomainError } from './booking-domain-error.mapper';
import { CreateBookingDto } from './dto/create-booking.dto';
import { CreateManagementBookingDto } from './dto/create-management-booking.dto';
import { BookingStayPolicy } from './domain/booking-stay.policy';
import {
  BookingCreationStore,
  BookingCreationConflictError,
  BookingCustomerStore,
  BookingRoomStore,
  CustomerIdentityConflictError,
} from './ports/booking-creation.store';
import {
  RoomCalendarReservationConflictError,
  RoomCalendarStore,
} from './ports/room-calendar.store';
import type { BookingAuditContext } from './booking.types';
import { Booking } from './schema/booking.entity';
import {
  BookingPaymentStatus,
  BookingRequestIntentActorType,
  BookingStatus,
} from './domain/booking-state';

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

interface BookingRequestIntent {
  actorType: BookingRequestIntentActorType;
  actorId: string;
  key: string;
  hash: string;
}

@Injectable()
export class BookingCreationService {
  private readonly logger = new Logger(BookingCreationService.name);
  private readonly paymentTimeoutMilliseconds: number;
  private readonly maxActiveUnpaidBookingsPerCustomer: number;
  private readonly maxHeldNightsPerCustomer: number;

  constructor(
    private readonly transactions: TransactionRunner,
    configService: ConfigService,
    private readonly bookingStayPolicy: BookingStayPolicy,
    private readonly bookings: BookingCreationStore,
    private readonly customers: BookingCustomerStore,
    private readonly rooms: BookingRoomStore,
    private readonly roomCalendar: RoomCalendarStore,
    private readonly auditLog: TransactionalAuditLog,
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
  }

  async createForCustomer(
    customerId: string | undefined,
    body: CreateBookingDto,
    context?: BookingAuditContext,
    requestIntentKey?: string,
  ): Promise<CustomerBookingCreationResult> {
    const activeCustomerId = this.requireActorId(customerId);
    const input = this.normalizeCreateInput(body);
    const requestIntent = this.buildRequestIntent(
      BookingRequestIntentActorType.CUSTOMER,
      activeCustomerId,
      requestIntentKey,
      { input },
    );
    const bookingId = await this.createBookingInTransaction(
      input,
      async (transaction) =>
        this.getActiveCustomer(transaction, activeCustomerId, true, true),
      null,
      true,
      AuditActorType.CUSTOMER,
      activeCustomerId,
      requestIntent,
      context?.requestId,
    );

    return { customerId: activeCustomerId, bookingId };
  }

  async createForManagement(
    userId: string | undefined,
    body: CreateManagementBookingDto,
    context?: BookingAuditContext,
    requestIntentKey?: string,
  ): Promise<string> {
    const createdByUserId = this.requireActorId(userId);
    const input = this.normalizeCreateInput(body);
    const requestedCustomerId = this.optionalId(
      body.customerId,
      'Customer id khong hop le.',
    );
    const requestIntent = this.buildRequestIntent(
      BookingRequestIntentActorType.USER,
      createdByUserId,
      requestIntentKey,
      { input, requestedCustomerId },
    );

    return this.createBookingInTransaction(
      input,
      async (transaction) =>
        this.resolveManagementCustomer(transaction, requestedCustomerId, input),
      createdByUserId,
      false,
      AuditActorType.USER,
      createdByUserId,
      requestIntent,
      context?.requestId,
    );
  }

  private async createBookingInTransaction(
    input: NormalizedCreateBookingInput,
    resolveCustomer: (context: TransactionContext) => Promise<Customer>,
    createdByUserId: string | null,
    enforceCustomerAdmission: boolean,
    actorType: AuditActorType,
    actorId: string,
    requestIntent: BookingRequestIntent | null,
    requestId?: string,
  ): Promise<string> {
    try {
      return await this.transactions.run(async (transaction) => {
        const existingBooking =
          requestIntent === null
            ? null
            : await this.bookings.findRequestIntent(transaction, {
                actorType: requestIntent.actorType,
                actorId: requestIntent.actorId,
                key: requestIntent.key,
              });

        if (existingBooking !== null && requestIntent !== null) {
          this.assertRequestIntentReplay(existingBooking, requestIntent);
          return existingBooking.id;
        }

        const customer = await resolveCustomer(transaction);

        if (enforceCustomerAdmission) {
          await this.assertCustomerBookingAdmission(
            transaction,
            customer.id,
            input.nights,
          );
        }

        const room = await this.getBookableRoom(transaction, input.roomId);

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
        const savedBooking = await this.bookings.createBooking(transaction, {
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
          requestIntentActorType: requestIntent?.actorType ?? null,
          requestIntentActorId: requestIntent?.actorId ?? null,
          requestIntentKey: requestIntent?.key ?? null,
          requestIntentHash: requestIntent?.hash ?? null,
        });
        await this.roomCalendar.reserveBookingStay(
          transaction,
          room.id,
          savedBooking.id,
          this.bookingStayPolicy.enumerateStayDates(
            input.checkInDate,
            input.checkOutDate,
          ),
        );
        await this.auditLog.record(transaction, {
          actorType,
          actorId,
          action: AuditAction.BOOKING_CREATED,
          entityType: AuditEntityType.BOOKING,
          entityId: savedBooking.id,
          requestId,
          metadata: {
            status: savedBooking.status,
            roomId: savedBooking.roomId,
            checkInDate: savedBooking.checkInDate,
            checkOutDate: savedBooking.checkOutDate,
          },
        });

        return savedBooking.id;
      });
    } catch (error) {
      if (
        requestIntent !== null &&
        error instanceof BookingCreationConflictError &&
        error.kind === 'REQUEST_INTENT'
      ) {
        const existingBooking = await this.bookings.findRequestIntentSnapshot({
          actorType: requestIntent.actorType,
          actorId: requestIntent.actorId,
          key: requestIntent.key,
        });

        if (existingBooking !== null) {
          this.assertRequestIntentReplay(existingBooking, requestIntent);
          return existingBooking.id;
        }
      }

      this.throwBookingWriteConflict(error, input.roomId, requestId);
    }
  }

  private buildRequestIntent(
    actorType: BookingRequestIntentActorType,
    actorId: string,
    rawKey: string | undefined,
    semanticRequest: Record<string, unknown>,
  ): BookingRequestIntent | null {
    if (rawKey === undefined) {
      return null;
    }

    const key = requireTrimmedString(
      rawKey,
      'Idempotency-Key khong hop le.',
      100,
    );

    if (!isValidIdempotencyKey(key)) {
      throw new BadRequestException('Idempotency-Key khong hop le.');
    }

    const hash = createHash('sha256')
      .update(
        JSON.stringify({
          actorType,
          actorId,
          ...semanticRequest,
        }),
      )
      .digest('hex');

    return { actorType, actorId, key, hash };
  }

  private assertRequestIntentReplay(
    booking: Booking,
    requestIntent: BookingRequestIntent,
  ): void {
    if (booking.requestIntentHash !== requestIntent.hash) {
      throw new AppHttpException(
        HttpStatus.CONFLICT,
        ErrorCode.BOOKING_REQUEST_INTENT_CONFLICT,
        'Idempotency-Key da duoc su dung cho request booking khac.',
      );
    }
  }

  private async resolveManagementCustomer(
    context: TransactionContext,
    requestedCustomerId: string | undefined,
    input: NormalizedCreateBookingInput,
  ): Promise<Customer> {
    if (requestedCustomerId !== undefined) {
      return this.getActiveCustomer(context, requestedCustomerId, false, false);
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

    const existingCustomer = await this.customers.findByPhoneVariants(
      context,
      getVietnamesePhoneLookupVariants(input.contactPhone),
    );

    if (existingCustomer !== null) {
      this.assertCustomerIsActive(existingCustomer);
      return existingCustomer;
    }

    if (input.contactEmail !== null && input.contactEmail !== undefined) {
      const existingEmail = await this.customers.findByEmail(
        context,
        input.contactEmail,
      );

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

    return this.customers.createPasswordless(context, {
      fullName: input.contactName,
      email: input.contactEmail ?? null,
      phone: input.contactPhone,
    });
  }

  private async getActiveCustomer(
    context: TransactionContext,
    id: string,
    missingIsUnauthorized: boolean,
    lockForBookingAdmission: boolean,
  ): Promise<Customer> {
    const customer = await this.customers.findById(
      context,
      id,
      lockForBookingAdmission,
    );

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
    context: TransactionContext,
    customerId: string,
    requestedNights: number,
  ): Promise<void> {
    const activeUnpaidCount = await this.bookings.countActiveUnpaid(
      context,
      customerId,
    );

    if (activeUnpaidCount >= this.maxActiveUnpaidBookingsPerCustomer) {
      throw new AppHttpException(
        HttpStatus.CONFLICT,
        ErrorCode.BOOKING_ACTIVE_UNPAID_LIMIT_REACHED,
        `Ban dang co toi da ${this.maxActiveUnpaidBookingsPerCustomer} booking cho thanh toan. Vui long thanh toan, huy hoac cho booking het han.`,
        { details: { limit: this.maxActiveUnpaidBookingsPerCustomer } },
      );
    }

    const activeUnpaidBookings = await this.bookings.findActiveUnpaidStayRanges(
      context,
      customerId,
    );
    const heldNights = activeUnpaidBookings.reduce(
      (total, booking) =>
        total +
        this.bookingStayPolicy.countNights(
          booking.checkInDate,
          booking.checkOutDate,
        ),
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
    context: TransactionContext,
    id: string,
  ): Promise<Room> {
    const room = await this.rooms.findBookableForUpdate(context, id);

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
    const stayRange = this.requireStayRange(
      body.checkInDate,
      body.checkOutDate,
    );

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
      checkInDate: stayRange.checkInDate,
      checkOutDate: stayRange.checkOutDate,
      nights: stayRange.nights,
      guestCount,
      contactName,
      contactPhone,
      contactEmail,
      customerNote,
    };
  }

  private requireStayRange(checkIn: unknown, checkOut: unknown) {
    try {
      return this.bookingStayPolicy.requireStayRange(checkIn, checkOut);
    } catch (error) {
      throwMappedBookingDomainError(error);
    }
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

  private throwBookingWriteConflict(
    error: unknown,
    roomId: string,
    requestId?: string,
  ): never {
    if (error instanceof RoomCalendarReservationConflictError) {
      this.logger.warn(
        `operation=booking_create errorCode=${ErrorCode.BOOKING_ROOM_UNAVAILABLE} requestId=${requestId ?? 'unavailable'} roomId=${roomId}`,
      );
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

    if (
      error instanceof CustomerIdentityConflictError &&
      error.kind === 'PHONE'
    ) {
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

    if (
      error instanceof CustomerIdentityConflictError &&
      error.kind === 'EMAIL'
    ) {
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

    if (
      error instanceof BookingCreationConflictError ||
      error instanceof CustomerIdentityConflictError
    ) {
      throw new AppHttpException(
        HttpStatus.CONFLICT,
        ErrorCode.BOOKING_CREATE_CONFLICT,
        'Khong the tao booking do du lieu bi trung.',
      );
    }

    throw error;
  }
}
