import {
  BadRequestException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes } from 'node:crypto';

import {
  type TransactionContext,
  TransactionRunner,
} from '../../common/database/transaction';
import { ErrorCode } from '../../common/error-codes';
import { AppHttpException } from '../../common/http/app-http-exception';
import {
  getPhoneLookupVariants,
  isValidIdempotencyKey,
  optionalId,
  requireActorId,
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
import { CreateBookingDto } from './dto/create-booking.dto';
import { CreateManagementBookingDto } from './dto/create-management-booking.dto';
import {
  assertActiveCustomer,
  assertActiveUnpaidLimit,
  assertBookingStayAllowed,
  assertGuestCapacity,
  assertHeldNightsLimit,
  requireBookableRoom,
  requireCounterCustomerContact,
} from './domain/booking-creation.policy';
import { BookingStayPolicy } from './domain/booking-stay.policy';
import {
  buildBookingCreatedAuditMetadata,
  buildBookingCreateInput,
  buildRoomCalendarReservationDates,
  type BookingCreationInput,
  type BookingRequestIntent,
  normalizeBookingCreationInput,
} from './mappers/booking-creation.mapper';
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
import { BookingRequestIntentActorType } from './domain/booking-state';

export interface CustomerBookingResult {
  customerId: string;
  bookingId: string;
}

@Injectable()
export class BookingCreationService {
  private readonly logger = new Logger(BookingCreationService.name);
  private readonly paymentTimeoutMs: number;
  private readonly maxUnpaidBookings: number;
  private readonly maxHeldNights: number;

  constructor(
    private readonly transactions: TransactionRunner,
    configService: ConfigService,
    private readonly stayPolicy: BookingStayPolicy,
    private readonly bookings: BookingCreationStore,
    private readonly customers: BookingCustomerStore,
    private readonly rooms: BookingRoomStore,
    private readonly roomCalendar: RoomCalendarStore,
    private readonly auditLog: TransactionalAuditLog,
  ) {
    this.paymentTimeoutMs =
      configService.getOrThrow<number>('BOOKING_PAYMENT_TIMEOUT_MINUTES') *
      60 *
      1000;
    this.maxUnpaidBookings = configService.getOrThrow<number>(
      'BOOKING_MAX_ACTIVE_UNPAID_PER_CUSTOMER',
    );
    this.maxHeldNights = configService.getOrThrow<number>(
      'BOOKING_MAX_HELD_NIGHTS_PER_CUSTOMER',
    );
  }

  async createForCustomer(
    customerId: string | undefined,
    body: CreateBookingDto,
    context?: BookingAuditContext,
    requestIntentKey?: string,
  ): Promise<CustomerBookingResult> {
    const activeCustomerId = requireActorId(customerId);
    const input = normalizeBookingCreationInput(body, this.stayPolicy);
    const requestIntent = this.buildRequestIntent(
      BookingRequestIntentActorType.CUSTOMER,
      activeCustomerId,
      requestIntentKey,
      { input },
    );
    if (requestIntent === null) {
      assertBookingStayAllowed(this.stayPolicy, input, new Date());
    }
    const bookingId = await this.createBooking(
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
    const createdByUserId = requireActorId(userId);
    const input = normalizeBookingCreationInput(body, this.stayPolicy);
    const requestedCustomerId = optionalId(body.customerId, 'Customer');
    const requestIntent = this.buildRequestIntent(
      BookingRequestIntentActorType.USER,
      createdByUserId,
      requestIntentKey,
      { input, requestedCustomerId },
    );
    if (requestIntent === null) {
      assertBookingStayAllowed(this.stayPolicy, input, new Date());
    }

    return this.createBooking(
      input,
      async (transaction) =>
        this.resolveCustomer(transaction, requestedCustomerId, input),
      createdByUserId,
      false,
      AuditActorType.USER,
      createdByUserId,
      requestIntent,
      context?.requestId,
    );
  }

  private async createBooking(
    input: BookingCreationInput,
    resolveCustomer: (context: TransactionContext) => Promise<Customer>,
    createdByUserId: string | null,
    enforceAdmission: boolean,
    actorType: AuditActorType,
    actorId: string,
    requestIntent: BookingRequestIntent | null,
    requestId?: string,
  ): Promise<string> {
    try {
      const lookup =
        requestIntent === null
          ? null
          : {
              actorType: requestIntent.actorType,
              actorId: requestIntent.actorId,
              key: requestIntent.key,
            };
      // Replay without opening a transaction or re-applying admission rules.
      // A consistent read inside REPEATABLE READ before the customer lock
      // would freeze a stale snapshot for the quota queries below.
      if (lookup !== null && requestIntent !== null) {
        const existingBooking =
          await this.bookings.findRequestIntentSnapshot(lookup);
        if (existingBooking !== null) {
          this.assertIntentReplay(existingBooking, requestIntent);
          return existingBooking.id;
        }
      }

      return await this.transactions.run(async (transaction) => {
        const customer = await resolveCustomer(transaction);

        // Customer admission holds its lock before the first consistent read.
        // Recheck identity: a concurrent request may have committed while we waited.
        const existingBooking =
          lookup === null
            ? null
            : await this.bookings.findRequestIntent(transaction, lookup);

        if (existingBooking !== null && requestIntent !== null) {
          this.assertIntentReplay(existingBooking, requestIntent);
          return existingBooking.id;
        }

        if (requestIntent !== null) {
          assertBookingStayAllowed(this.stayPolicy, input, new Date());
        }

        if (enforceAdmission) {
          await this.assertAdmission(transaction, customer.id, input.nights);
        }

        const room = await this.lockBookableRoom(transaction, input.roomId);
        assertGuestCapacity(input.guestCount, room.roomType.maxGuests);

        const savedBooking = await this.bookings.createBooking(
          transaction,
          buildBookingCreateInput({
            input,
            customer,
            room,
            createdByUserId,
            requestIntent,
            bookingCode: this.createBookingCode(),
            paymentExpiresAt: new Date(Date.now() + this.paymentTimeoutMs),
          }),
        );
        await this.roomCalendar.reserveBookingStay(
          transaction,
          room.id,
          savedBooking.id,
          buildRoomCalendarReservationDates(input, this.stayPolicy),
        );
        await this.auditLog.record(transaction, {
          actorType,
          actorId,
          action: AuditAction.BOOKING_CREATED,
          entityType: AuditEntityType.BOOKING,
          entityId: savedBooking.id,
          requestId,
          metadata: buildBookingCreatedAuditMetadata(savedBooking),
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
          this.assertIntentReplay(existingBooking, requestIntent);
          return existingBooking.id;
        }
      }

      this.throwWriteConflict(error, input.roomId, requestId);
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

  private assertIntentReplay(
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

  private async resolveCustomer(
    context: TransactionContext,
    requestedCustomerId: string | undefined,
    input: BookingCreationInput,
  ): Promise<Customer> {
    if (requestedCustomerId !== undefined) {
      return this.getActiveCustomer(context, requestedCustomerId, false, false);
    }

    const contact = requireCounterCustomerContact(
      input.contactName,
      input.contactPhone,
    );

    const existingCustomer = await this.customers.findByPhoneVariants(
      context,
      getPhoneLookupVariants(contact.contactPhone),
    );

    if (existingCustomer !== null) {
      return assertActiveCustomer(existingCustomer, false);
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
      fullName: contact.contactName,
      email: input.contactEmail ?? null,
      phone: contact.contactPhone,
    });
  }

  private async getActiveCustomer(
    context: TransactionContext,
    id: string,
    missingIsUnauthorized: boolean,
    lockForAdmission: boolean,
  ): Promise<Customer> {
    const customer = await this.customers.findById(
      context,
      id,
      lockForAdmission,
    );

    return assertActiveCustomer(customer, missingIsUnauthorized);
  }

  private async assertAdmission(
    context: TransactionContext,
    customerId: string,
    requestedNights: number,
  ): Promise<void> {
    const activeUnpaidCount = await this.bookings.countActiveUnpaid(
      context,
      customerId,
    );

    assertActiveUnpaidLimit(activeUnpaidCount, this.maxUnpaidBookings);

    const activeUnpaidBookings = await this.bookings.findActiveUnpaidStayRanges(
      context,
      customerId,
    );
    const heldNights = activeUnpaidBookings.reduce(
      (total, booking) =>
        total +
        this.stayPolicy.countNights(booking.checkInDate, booking.checkOutDate),
      0,
    );

    assertHeldNightsLimit(heldNights, requestedNights, this.maxHeldNights);
  }

  private async lockBookableRoom(
    context: TransactionContext,
    id: string,
  ): Promise<Room> {
    return requireBookableRoom(
      await this.rooms.findBookableForUpdate(context, id),
    );
  }

  private createBookingCode(): string {
    const timestamp = Date.now().toString(36).toUpperCase();
    const random = randomBytes(6).toString('hex').toUpperCase();

    return `BK${timestamp}${random}`;
  }

  private throwWriteConflict(
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
