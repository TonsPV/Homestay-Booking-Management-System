import { BadRequestException } from '@nestjs/common';

import {
  BookingPaymentStatus,
  BookingRequestIntentActorType,
  BookingStatus,
} from '../../../../src/module/booking/domain/booking-state';
import { BookingStayPolicy } from '../../../../src/module/booking/domain/booking-stay.policy';
import {
  buildBookingCreatedAuditMetadata,
  buildBookingCreateInput,
  buildRoomCalendarReservationDates,
  normalizeBookingCreationInput,
} from '../../../../src/module/booking/infrastructure/mapper/booking-creation.mapper';
import type { Booking } from '../../../../src/module/booking/schema/booking.entity';
import type { Customer } from '../../../../src/module/customer/schema/customer.entity';
import type { Room } from '../../../../src/module/room/schema/room.entity';

describe('booking creation mapper', () => {
  const stayPolicy = new BookingStayPolicy(365);

  it('prioritizes the room ID error when stay dates and guest count are also invalid', () => {
    const normalize = () =>
      normalizeBookingCreationInput(
        {
          roomId: '0',
          checkInDate: 'invalid-date',
          checkOutDate: 'invalid-date',
          guestCount: 0,
        },
        stayPolicy,
      );

    expect(normalize).toThrow(BadRequestException);
    expect(normalize).toThrow('Room id khong hop le.');
  });

  it('normalizes a create DTO without changing semantic values', () => {
    expect(
      normalizeBookingCreationInput(
        {
          roomId: '1',
          checkInDate: '2030-02-01',
          checkOutDate: '2030-02-04',
          guestCount: 2,
          contactName: '  Guest Name  ',
          customerNote: null,
        },
        stayPolicy,
      ),
    ).toEqual({
      roomId: '1',
      checkInDate: '2030-02-01',
      checkOutDate: '2030-02-04',
      nights: 3,
      guestCount: 2,
      contactName: 'Guest Name',
      contactPhone: undefined,
      contactEmail: undefined,
      customerNote: null,
    });
  });

  it('builds persistence input with contact and price snapshots', () => {
    const input = normalizeBookingCreationInput(
      {
        roomId: '1',
        checkInDate: '2030-02-01',
        checkOutDate: '2030-02-04',
        guestCount: 2,
      },
      stayPolicy,
    );
    const paymentExpiresAt = new Date('2030-01-01T00:15:00.000Z');

    expect(
      buildBookingCreateInput({
        input,
        customer: {
          id: '10',
          fullName: 'Customer Name',
          phone: '0901234567',
          email: 'customer@example.com',
        } as Customer,
        room: {
          id: '1',
          roomType: { basePrice: '1000000.00' },
        } as Room,
        createdByUserId: '20',
        requestIntent: {
          actorType: BookingRequestIntentActorType.USER,
          actorId: '20',
          key: 'booking-intent-001',
          hash: 'hash',
        },
        bookingCode: 'BK1',
        paymentExpiresAt,
      }),
    ).toMatchObject({
      bookingCode: 'BK1',
      customerId: '10',
      roomId: '1',
      createdByUserId: '20',
      contactName: 'Customer Name',
      contactPhone: '+84901234567',
      contactEmail: 'customer@example.com',
      totalAmount: '3000000.00',
      status: BookingStatus.PENDING_PAYMENT,
      paymentStatus: BookingPaymentStatus.UNPAID,
      paymentExpiresAt,
      requestIntentActorType: BookingRequestIntentActorType.USER,
      requestIntentActorId: '20',
      requestIntentKey: 'booking-intent-001',
      requestIntentHash: 'hash',
    });
  });

  it('builds reservation dates and audit metadata', () => {
    const input = normalizeBookingCreationInput(
      {
        roomId: '1',
        checkInDate: '2030-02-01',
        checkOutDate: '2030-02-04',
        guestCount: 2,
      },
      stayPolicy,
    );
    const booking = {
      status: BookingStatus.PENDING_PAYMENT,
      roomId: '1',
      checkInDate: '2030-02-01',
      checkOutDate: '2030-02-04',
    } as Booking;

    expect(buildRoomCalendarReservationDates(input, stayPolicy)).toEqual([
      '2030-02-01',
      '2030-02-02',
      '2030-02-03',
    ]);
    expect(buildBookingCreatedAuditMetadata(booking)).toEqual({
      status: BookingStatus.PENDING_PAYMENT,
      roomId: '1',
      checkInDate: '2030-02-01',
      checkOutDate: '2030-02-04',
    });
  });
});
