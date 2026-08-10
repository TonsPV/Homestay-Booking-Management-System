import { BadRequestException, HttpStatus, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AppHttpException, ErrorCode } from '../../common/http';

const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;
const VIETNAM_UTC_OFFSET_MILLISECONDS = 7 * 60 * 60 * 1000;
export const MAX_STAY_NIGHTS = 90;

export interface BookingStayRange {
  checkInDate: string;
  checkOutDate: string;
  nights: number;
}

export interface BookingStayFieldNames {
  checkIn: string;
  checkOut: string;
}

const DEFAULT_FIELD_NAMES: BookingStayFieldNames = {
  checkIn: 'checkInDate',
  checkOut: 'checkOutDate',
};

@Injectable()
export class BookingStayPolicy {
  private readonly maxAdvanceBookingDays: number;

  constructor(configService: ConfigService) {
    this.maxAdvanceBookingDays = configService.getOrThrow<number>(
      'BOOKING_MAX_ADVANCE_DAYS',
    );
  }

  requireStayRange(
    checkInValue: unknown,
    checkOutValue: unknown,
    fieldNames: BookingStayFieldNames = DEFAULT_FIELD_NAMES,
  ): BookingStayRange {
    const checkInDate = this.requireIsoDate(
      checkInValue,
      'Ngay check-in khong hop le.',
    );
    const checkOutDate = this.requireIsoDate(
      checkOutValue,
      'Ngay check-out khong hop le.',
    );
    const nights = this.countNights(checkInDate, checkOutDate);

    if (nights <= 0) {
      throw new AppHttpException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BOOKING_DATE_RANGE_INVALID,
        'Ngay check-out phai sau ngay check-in.',
        {
          fieldErrors: {
            [fieldNames.checkOut]: [
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
            [fieldNames.checkOut]: [
              {
                errorCode: ErrorCode.BOOKING_STAY_TOO_LONG,
                message: `Booking khong duoc vuot qua ${MAX_STAY_NIGHTS} dem.`,
              },
            ],
          },
        },
      );
    }

    const currentVietnamDate = this.getCurrentVietnamDate();

    if (checkInDate < currentVietnamDate) {
      throw new AppHttpException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BOOKING_CHECKIN_IN_PAST,
        'Ngay check-in khong duoc nam trong qua khu.',
        {
          fieldErrors: {
            [fieldNames.checkIn]: [
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
      this.countNights(currentVietnamDate, checkInDate) >
      this.maxAdvanceBookingDays
    ) {
      throw new AppHttpException(
        HttpStatus.BAD_REQUEST,
        ErrorCode.BOOKING_CHECKIN_TOO_FAR,
        `Ngay check-in khong duoc qua ${this.maxAdvanceBookingDays} ngay ke tu hom nay.`,
        {
          details: { maxAdvanceDays: this.maxAdvanceBookingDays },
          fieldErrors: {
            [fieldNames.checkIn]: [
              {
                errorCode: ErrorCode.BOOKING_CHECKIN_TOO_FAR,
                message: 'Ngay check-in vuot qua thoi gian dat truoc.',
              },
            ],
          },
        },
      );
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

  private getCurrentVietnamDate(now = new Date()): string {
    return new Date(now.getTime() + VIETNAM_UTC_OFFSET_MILLISECONDS)
      .toISOString()
      .slice(0, 10);
  }
}
