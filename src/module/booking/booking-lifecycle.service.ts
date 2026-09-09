import {
  BadRequestException,
  Injectable,
  HttpStatus,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';

import {
  type TransactionContext,
  TransactionRunner,
} from '../../common/application/transaction';
import { ErrorCode } from '../../common/error-codes';
import { AppHttpException } from '../../common/http/app-http-exception';
import { optionalNullableTrimmedString } from '../../common/validation';
import {
  AuditAction,
  AuditActorType,
  AuditEntityType,
} from '../audit/domain/audit-log';
import { TransactionalAuditLog } from '../audit/ports/transactional-audit-log';
import { Room } from '../room/schema/room.entity';
import { RoomStatus } from '../room/domain/room-status';
import { throwMappedBookingDomainError } from './booking-domain-error.mapper';
import { BookingPaymentLifecycleService } from './booking-payment-lifecycle.service';
import { CancelBookingDto } from './dto/cancel-booking.dto';
import { UpdateBookingStatusDto } from './dto/update-booking-status.dto';
import { BookingTransitionPolicy } from './domain/booking-transition.policy';
import {
  BookingLifecycleStore,
  BookingPaymentStateStore,
} from './ports/booking-lifecycle.store';
import type { BookingAuditContext } from './booking.types';
import { Booking } from './schema/booking.entity';
import { BookingStatus } from './domain/booking-state';

/**
 * Booking command entry point for customer/management lifecycle requests
 * and the booking expiry scheduler. Cross-aggregate transitions
 * (cancellation with payment fail + calendar release, expiry batch) are
 * delegated to BookingPaymentLifecycleService; this class keeps request
 * validation, booking-only room-stay transitions and audit formatting.
 */
@Injectable()
export class BookingLifecycleService {
  constructor(
    private readonly transactions: TransactionRunner,
    private readonly transitionPolicy: BookingTransitionPolicy,
    private readonly lifecycle: BookingPaymentLifecycleService,
    private readonly bookings: BookingLifecycleStore,
    private readonly payments: BookingPaymentStateStore,
    private readonly auditLog: TransactionalAuditLog,
  ) {}

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

    await this.transactions.run(async (transaction) => {
      const booking = await this.lockBooking(transaction, id);

      if (booking.customerId !== activeCustomerId) {
        throw new NotFoundException('Khong tim thay booking.');
      }

      const fromStatus = booking.status;
      const changed = await this.lifecycle.cancelBooking(
        transaction,
        booking,
        reason,
        true,
      );

      if (changed) {
        await this.recordStatusAudit(
          transaction,
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
    const status = this.requireStatus(body.status);
    const cancellationReason = this.normalizeCancelReason(
      body.cancellationReason,
    );

    await this.transactions.run(async (transaction) => {
      const booking = await this.lockBooking(transaction, id);

      if (booking.status === status) {
        return;
      }

      const fromStatus = booking.status;
      const refundPending = await this.payments.hasPendingRefund(
        transaction,
        booking.id,
      );
      const room = await this.lockRoomForTransition(
        transaction,
        booking,
        status,
      );
      const capability = this.transitionPolicy.evaluate(booking, status, {
        refundPending,
        roomExists:
          status === BookingStatus.CHECKED_IN ||
          status === BookingStatus.CHECKED_OUT
            ? room !== null
            : undefined,
        roomStatus: room?.status,
      });
      try {
        this.transitionPolicy.assertAllowed(booking, capability);
      } catch (error) {
        throwMappedBookingDomainError(error);
      }

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

        const changed = await this.lifecycle.cancelBooking(
          transaction,
          booking,
          cancellationReason,
          false,
        );

        if (changed) {
          await this.recordStatusAudit(
            transaction,
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

      await this.applyRoomTransition(transaction, booking, status, room);

      booking.status = status;
      booking.paymentExpiresAt = null;
      await this.bookings.saveState(transaction, booking);
      await this.recordStatusAudit(
        transaction,
        booking,
        AuditAction.BOOKING_STATUS_CHANGED,
        AuditActorType.USER,
        userId ?? null,
        fromStatus,
        context?.requestId,
      );
    });
  }

  async expireUnpaidBookings(now = new Date()): Promise<number> {
    return this.lifecycle.expireUnpaidBookings(now);
  }

  private async lockBooking(
    context: TransactionContext,
    id: string,
  ): Promise<Booking> {
    const booking = await this.bookings.findForUpdate(context, id);

    if (booking === null) {
      throw new NotFoundException('Khong tim thay booking.');
    }

    return booking;
  }

  private async lockRoomForTransition(
    context: TransactionContext,
    booking: Booking,
    nextStatus: BookingStatus,
  ): Promise<Room | null> {
    if (
      nextStatus !== BookingStatus.CHECKED_IN &&
      nextStatus !== BookingStatus.CHECKED_OUT
    ) {
      return null;
    }

    return this.bookings.findStayRoomForUpdate(context, booking.roomId);
  }

  private async recordStatusAudit(
    context: TransactionContext,
    booking: Booking,
    action: AuditAction,
    actorType: AuditActorType,
    actorId: string | null,
    fromStatus: BookingStatus,
    requestId?: string,
  ): Promise<void> {
    await this.auditLog.record(context, {
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

  private async applyRoomTransition(
    context: TransactionContext,
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

    await this.bookings.saveRoomState(context, room);
  }

  private normalizeCancelReason(value: unknown): string | null {
    if (value === undefined || value === null || value === '') {
      return null;
    }

    if (typeof value !== 'string') {
      this.rejectCancelReason('Ly do huy booking khong hop le.');
    }

    const cancellationReason = value.trim();

    if (cancellationReason.length === 0) {
      return null;
    }

    if (cancellationReason.length > 500) {
      this.rejectCancelReason(
        'Ly do huy booking khong duoc vuot qua 500 ky tu.',
      );
    }

    return cancellationReason;
  }

  private rejectCancelReason(message: string): never {
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

  private requireStatus(value: unknown): BookingStatus {
    const status = this.optionalStatus(value);

    if (status === undefined) {
      throw new BadRequestException('Trang thai booking khong hop le.');
    }

    return status;
  }

  private optionalStatus(value: unknown): BookingStatus | undefined {
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
