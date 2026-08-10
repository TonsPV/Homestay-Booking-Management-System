import type { ConfigService } from '@nestjs/config';

import { ErrorCode } from '../../common/http';
import { BookingStayPolicy } from './booking-stay.policy';

describe('BookingStayPolicy', () => {
  let policy: BookingStayPolicy;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    policy = new BookingStayPolicy({
      getOrThrow: jest.fn().mockReturnValue(365),
    } as unknown as ConfigService);
  });

  afterEach(() => jest.useRealTimers());

  it('normalizes one shared half-open stay range and enumerates its nights', () => {
    expect(policy.requireStayRange(' 2030-01-10 ', '2030-01-12')).toEqual({
      checkInDate: '2030-01-10',
      checkOutDate: '2030-01-12',
      nights: 2,
    });
    expect(policy.enumerateStayDates('2030-01-10', '2030-01-12')).toEqual([
      '2030-01-10',
      '2030-01-11',
    ]);
  });

  it.each([
    ['2029-12-31', '2030-01-02', ErrorCode.BOOKING_CHECKIN_IN_PAST],
    ['2030-01-02', '2030-01-01', ErrorCode.BOOKING_DATE_RANGE_INVALID],
    ['2030-01-02', '2030-04-03', ErrorCode.BOOKING_STAY_TOO_LONG],
    ['2031-01-02', '2031-01-03', ErrorCode.BOOKING_CHECKIN_TOO_FAR],
  ])(
    'rejects a range that create and search must both reject',
    (from, to, code) => {
      expect.assertions(1);

      try {
        policy.requireStayRange(from, to, {
          checkIn: 'checkIn',
          checkOut: 'checkOut',
        });
      } catch (error) {
        expect(error).toHaveProperty('response.errorCode', code);
      }
    },
  );
});
