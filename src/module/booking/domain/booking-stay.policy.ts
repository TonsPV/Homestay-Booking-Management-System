import {
  BookingCheckInInPastError,
  BookingCheckInTooFarError,
  BookingStayTooLongError,
  InvalidBookingDateRangeError,
  InvalidBookingStayDateError,
} from './booking.errors';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const VIETNAM_UTC_OFFSET_MILLISECONDS = 7 * 60 * 60 * 1000;
export const MAX_STAY_NIGHTS = 90;

export interface BookingStayRange {
  checkInDate: string;
  checkOutDate: string;
  nights: number;
}

export class BookingStayPolicy {
  constructor(private readonly maxAdvanceBookingDays: number) {}

  requireStayRange(
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

    const currentVietnamDate = this.getCurrentVietnamDate();

    if (checkInDate < currentVietnamDate) {
      throw new BookingCheckInInPastError();
    }

    if (
      this.countNights(currentVietnamDate, checkInDate) >
      this.maxAdvanceBookingDays
    ) {
      throw new BookingCheckInTooFarError(this.maxAdvanceBookingDays);
    }

    return { checkInDate, checkOutDate, nights };
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
    if (typeof value !== 'string') {
      throw new InvalidBookingStayDateError(field, message);
    }

    const date = value.trim();
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);

    if (match === null) {
      throw new InvalidBookingStayDateError(field, message);
    }

    const parsed = new Date(`${date}T00:00:00.000Z`);

    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.getUTCFullYear() !== Number(match[1]) ||
      parsed.getUTCMonth() + 1 !== Number(match[2]) ||
      parsed.getUTCDate() !== Number(match[3])
    ) {
      throw new InvalidBookingStayDateError(field, message);
    }

    return date;
  }

  private getCurrentVietnamDate(now = new Date()): string {
    return new Date(now.getTime() + VIETNAM_UTC_OFFSET_MILLISECONDS)
      .toISOString()
      .slice(0, 10);
  }
}
