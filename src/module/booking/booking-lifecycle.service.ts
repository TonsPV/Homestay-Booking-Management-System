import {
  BadRequestException,
  Injectable,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DataSource, type EntityManager, In } from 'typeorm';

import { ErrorCode } from '../../common/error-codes';
import { AppHttpException } from '../../common/http/app-http-exception';
import { optionalNullableTrimmedString } from '../../common/validation';
import { AuditLogService } from '../audit/audit-log.service';
import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
} from '../audit/schema/audit-log.entity';
import {
  Payment,
  PaymentMethod,
  PaymentStatus,
} from '../payment/schema/payment.entity';
import { Room, RoomStatus } from '../room/schema/room.entity';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { UpdateBookingStatusDto } from './dto/update-booking-status.dto';
import { BookingTransitionPolicy } from './booking-transition.policy';
import type { BookingAuditContext } from './booking.types';
import {
  Booking,
  BookingPaymentStatus,
  BookingStatus,
} from './schema/booking.entity';
import { RoomCalendar } from './schema/room-calendar.entity';

@Injectable()
export class BookingLifecycleService {
  private readonly paymentTimeoutMilliseconds: number;

  constructor(
    private readonly dataSource: DataSource,
    configService: ConfigService,
    private readonly bookingTransitionPolicy: BookingTransitionPolicy,
    private readonly auditLogService: AuditLogService,
  ) {
    this.paymentTimeoutMilliseconds =
      configService.getOrThrow<number>('BOOKING_PAYMENT_TIMEOUT_MINUTES') *
      60 *
      1000;
  }

  async cancelForCustomer(
    customerId: string | undefined,
    id: string,
    body: CancelBookingDto,
    context?: BookingAuditContext,
  ): Promise<string> {
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

      const fromStatus = booking.status;
      const changed = await this.cancelBooking(manager, booking, reason, true);

      if (changed) {
        await this.recordStatusAudit(
          manager,
          booking,
          AuditAction.BOOKING_CANCELLED,
          AuditActorType.CUSTOMER,
          activeCustomerId,
          fromStatus,
          context?.requestId,
        );
      }
    });

    return activeCustomerId;
  }

  async updateStatus(
    id: string,
    body: UpdateBookingStatusDto,
    userId?: string,
    context?: BookingAuditContext,
  ): Promise<void> {
    this.validateId(id, 'Booking id khong hop le.');
    const status = this.requireBookingStatus(body.status);
    const cancellationReason = this.normalizeManagementCancellationReason(
      body.cancellationReason,
    );

    await this.dataSource.transaction(async (manager) => {
      const booking = await this.getLockedBooking(manager, id);

      if (booking.status === status) {
        return;
      }

      const fromStatus = booking.status;

      const refundPending = await manager.getRepository(Payment).existsBy({
        bookingId: booking.id,
        status: PaymentStatus.REFUND_PENDING,
      });
      const room = await this.getLockedRoomForTransition(
        manager,
        booking,
        status,
      );
      const capability = this.bookingTransitionPolicy.evaluate(
        booking,
        status,
        {
          refundPending,
          roomExists:
            status === BookingStatus.CHECKED_IN ||
            status === BookingStatus.CHECKED_OUT
              ? room !== null
              : undefined,
          roomStatus: room?.status,
        },
      );
      this.bookingTransitionPolicy.assertAllowed(booking, capability);

      if (status === BookingStatus.CANCELLED) {
        if (cancellationReason === null) {
          throw new AppHttpException(
            HttpStatus.BAD_REQUEST,
            ErrorCode.BOOKING_CANCELLATION_REASON_REQUIRED,
            'Ly do huy booking la bat buoc.',
            {
              fieldErrors: {
                cancellationReason: [
                  {
                    errorCode: ErrorCode.BOOKING_CANCELLATION_REASON_REQUIRED,
                    message: 'Ly do huy booking la bat buoc.',
                  },
                ],
              },
            },
          );
        }

        const changed = await this.cancelBooking(
          manager,
          booking,
          cancellationReason,
          false,
        );

        if (changed) {
          await this.recordStatusAudit(
            manager,
            booking,
            AuditAction.BOOKING_CANCELLED,
            AuditActorType.USER,
            userId ?? null,
            fromStatus,
            context?.requestId,
          );
        }
        return;
      }

      await this.applyRoomStayTransition(manager, booking, status, room);

      booking.status = status;
      booking.paymentExpiresAt = null;
      await manager.getRepository(Booking).save(booking);
      await this.recordStatusAudit(
        manager,
        booking,
        AuditAction.BOOKING_STATUS_CHANGED,
        AuditActorType.USER,
        userId ?? null,
        fromStatus,
        context?.requestId,
      );
    });
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
        booking.cancellationReason = 'Thanh toán đã hết hạn.';
      }

      await bookingsRepository.save(expiredBookings);
      await this.failPendingOnlinePayments(manager, bookingIds, 'EXPIRED');
      await manager.getRepository(RoomCalendar).delete({
        bookingId: In(bookingIds),
      });

      for (const booking of expiredBookings) {
        await this.recordStatusAudit(
          manager,
          booking,
          AuditAction.BOOKING_CANCELLED,
          AuditActorType.SYSTEM,
          null,
          BookingStatus.PENDING_PAYMENT,
        );
      }

      return expiredBookings.length;
    });
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

  private async getLockedRoomForTransition(
    manager: EntityManager,
    booking: Booking,
    nextStatus: BookingStatus,
  ): Promise<Room | null> {
    if (
      nextStatus !== BookingStatus.CHECKED_IN &&
      nextStatus !== BookingStatus.CHECKED_OUT
    ) {
      return null;
    }

    return manager
      .getRepository(Room)
      .createQueryBuilder('room')
      .setLock('pessimistic_write')
      .where('room.id = :roomId', { roomId: booking.roomId })
      .andWhere('room.deletedAt IS NULL')
      .getOne();
  }

  private async cancelBooking(
    manager: EntityManager,
    booking: Booking,
    reason: string | null,
    customerRequested: boolean,
  ): Promise<boolean> {
    if (booking.status === BookingStatus.CANCELLED) {
      return false;
    }

    if (booking.paymentStatus === BookingPaymentStatus.PAID) {
      throw new AppHttpException(
        HttpStatus.CONFLICT,
        ErrorCode.BOOKING_CANCELLATION_ALREADY_PAID,
        'Booking da thanh toan. Can hoan tien truoc khi huy.',
      );
    }

    if (
      customerRequested &&
      booking.status !== BookingStatus.PENDING_PAYMENT &&
      booking.status !== BookingStatus.CONFIRMED
    ) {
      throw new AppHttpException(
        HttpStatus.CONFLICT,
        ErrorCode.BOOKING_CANCELLATION_NOT_ALLOWED,
        'Customer khong the huy booking o trang thai hien tai.',
      );
    }

    if (
      !customerRequested &&
      !this.bookingTransitionPolicy.evaluate(booking, BookingStatus.CANCELLED)
        .allowed
    ) {
      throw new AppHttpException(
        HttpStatus.CONFLICT,
        ErrorCode.BOOKING_CANCELLATION_NOT_ALLOWED,
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

    return true;
  }

  private async recordStatusAudit(
    manager: EntityManager,
    booking: Booking,
    action: AuditAction,
    actorType: AuditActorType,
    actorId: string | null,
    fromStatus: BookingStatus,
    requestId?: string,
  ): Promise<void> {
    await this.auditLogService.record(manager, {
      actorType,
      actorId,
      action,
      entityType: AuditEntityType.BOOKING,
      entityId: booking.id,
      requestId,
      metadata: {
        fromStatus,
        toStatus: booking.status,
        cancellationReason: booking.cancellationReason,
      },
    });
  }

  private async applyRoomStayTransition(
    manager: EntityManager,
    booking: Booking,
    nextStatus: BookingStatus,
    room: Room | null,
  ): Promise<void> {
    if (
      nextStatus !== BookingStatus.CHECKED_IN &&
      nextStatus !== BookingStatus.CHECKED_OUT
    ) {
      return;
    }

    if (room === null) {
      throw new AppHttpException(
        HttpStatus.CONFLICT,
        ErrorCode.BOOKING_ROOM_MISSING_FOR_BOOKING,
        'Phong cua booking khong con ton tai.',
      );
    }

    if (nextStatus === BookingStatus.CHECKED_IN) {
      if (room.status !== RoomStatus.READY) {
        throw new AppHttpException(
          HttpStatus.CONFLICT,
          ErrorCode.BOOKING_ROOM_NOT_READY,
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

  private normalizeManagementCancellationReason(value: unknown): string | null {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    if (typeof value !== 'string') {
      this.throwCancellationReasonValidation('Ly do huy booking khong hop le.');
    }

    const cancellationReason = value.trim();

    if (cancellationReason.length === 0) {
      return null;
    }

    if (cancellationReason.length > 500) {
      this.throwCancellationReasonValidation(
        'Ly do huy booking khong duoc vuot qua 500 ky tu.',
      );
    }

    return cancellationReason;
  }

  private throwCancellationReasonValidation(message: string): never {
    throw new AppHttpException(
      HttpStatus.BAD_REQUEST,
      ErrorCode.COMMON_VALIDATION_FAILED,
      message,
      {
        fieldErrors: {
          cancellationReason: [
            {
              errorCode: ErrorCode.COMMON_VALIDATION_FAILED,
              message,
            },
          ],
        },
      },
    );
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

  private validateId(id: string, message: string): void {
    this.requireId(id, message);
  }
}
