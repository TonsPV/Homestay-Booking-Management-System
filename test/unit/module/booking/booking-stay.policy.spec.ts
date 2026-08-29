import { BookingStayPolicy } from '../../../../src/module/booking/domain/booking-stay.policy';
import {
  BookingCheckInInPastError,
  BookingCheckInTooFarError,
  BookingStayTooLongError,
  InvalidBookingDateRangeError,
  InvalidBookingStayDateError,
} from '../../../../src/module/booking/domain/booking.errors';

describe('BookingStayPolicy', () => {
  let policy: BookingStayPolicy;
  const rejectedRanges: ReadonlyArray<readonly [string, string, string]> = [
    ['2029-12-31', '2030-01-02', BookingCheckInInPastError.name],
    ['2030-01-02', '2030-01-01', InvalidBookingDateRangeError.name],
    ['2030-01-02', '2030-04-03', BookingStayTooLongError.name],
    ['2031-01-02', '2031-01-03', BookingCheckInTooFarError.name],
  ];

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2030-01-01T00:00:00.000Z'));
    policy = new BookingStayPolicy(365);
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

  it.each(rejectedRanges)(
    'rejects a range with a semantic domain error',
    (from, to, expectedErrorName) => {
      expect.assertions(1);

      try {
        policy.requireStayRange(from, to);
      } catch (error) {
        expect(error).toHaveProperty('name', expectedErrorName);
      }
    },
  );

  it('reports which date value is invalid without knowing HTTP field names', () => {
    expect.assertions(1);

    try {
      policy.requireStayRange('2030-02-30', '2030-03-02');
    } catch (error) {
      expect(error).toMatchObject({
        name: InvalidBookingStayDateError.name,
        field: 'checkIn',
      });
    }
  });
});
