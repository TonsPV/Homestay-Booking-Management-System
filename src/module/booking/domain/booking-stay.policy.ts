import { currentVietnamDate, parseIsoDate } from '../../../common/validation';
import {
  BookingCheckInInPastError,
  BookingCheckInTooFarError,
  BookingStayTooLongError,
  InvalidBookingDateRangeError,
  InvalidBookingStayDateError,
} from './booking.errors';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
export const MAX_STAY_NIGHTS = 90;

export interface BookingStayRange {
  checkInDate: string;
  checkOutDate: string;
  nights: number;
}

export class BookingStayPolicy {
  constructor(private readonly maxAdvanceDays: number) {}

  normalizeStayRange(
    checkInValue: unknown,
    checkOutValue: unknown,
  ): BookingStayRange {
    const checkInDate = this.requireIsoDate(
      checkInValue,
      'checkIn',
      'Ngay check-in khong hop le.',
    );
    const checkOutDate = this.requireIsoDate(
      checkOutValue,
      'checkOut',
      'Ngay check-out khong hop le.',
    );
    const nights = this.countNights(checkInDate, checkOutDate);

    if (nights <= 0) {
      throw new InvalidBookingDateRangeError();
    }

    if (nights > MAX_STAY_NIGHTS) {
      throw new BookingStayTooLongError(MAX_STAY_NIGHTS);
    }

    return { checkInDate, checkOutDate, nights };
  }

  assertWithinBookingWindow(
    stayRange: BookingStayRange,
    now = new Date(),
  ): void {
    const today = currentVietnamDate(now);

    if (stayRange.checkInDate < today) {
      throw new BookingCheckInInPastError();
    }

    if (this.countNights(today, stayRange.checkInDate) > this.maxAdvanceDays) {
      throw new BookingCheckInTooFarError(this.maxAdvanceDays);
    }
  }

  requireStayRange(
    checkInValue: unknown,
    checkOutValue: unknown,
  ): BookingStayRange {
    const stayRange = this.normalizeStayRange(checkInValue, checkOutValue);
    this.assertWithinBookingWindow(stayRange);
    return stayRange;
  }

  countNights(checkInDate: string, checkOutDate: string): number {
    const checkIn = Date.parse(`${checkInDate}T00:00:00.000Z`);
    const checkOut = Date.parse(`${checkOutDate}T00:00:00.000Z`);

    return (checkOut - checkIn) / MILLISECONDS_PER_DAY;
  }

  enumerateStayDates(checkInDate: string, checkOutDate: string): string[] {
    const dates: string[] = [];
    const checkIn = Date.parse(`${checkInDate}T00:00:00.000Z`);
    const checkOut = Date.parse(`${checkOutDate}T00:00:00.000Z`);

    for (
      let stayDate = checkIn;
      stayDate < checkOut;
      stayDate += MILLISECONDS_PER_DAY
    ) {
      dates.push(new Date(stayDate).toISOString().slice(0, 10));
    }

    return dates;
  }

  private requireIsoDate(
    value: unknown,
    field: 'checkIn' | 'checkOut',
    message: string,
  ): string {
    const date = parseIsoDate(value);

    if (date === null) {
      throw new InvalidBookingStayDateError(field, message);
    }

    return date;
  }
}
