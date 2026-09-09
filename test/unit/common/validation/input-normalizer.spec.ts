import { BadRequestException, UnauthorizedException } from '@nestjs/common';

import {
  currentVietnamDate,
  getPhoneLookupVariants,
  optionalEnumValue,
  optionalId,
  normalizePhone,
  optionalAccountStatus,
  parseIsoDate,
  parseBoolean,
  requireActorId,
  requireAccountStatus,
  requireDecimalAmount,
  requireEnumValue,
  requireId,
  requirePositiveDecimalAmount,
  requirePassword,
  requirePositiveInt,
} from '../../../../src/common/validation/input-normalizer';

describe('input normalizer', () => {
  it('normalizes shared positive ids and preserves field-specific messages', () => {
    expect(requireId('42', 'Booking')).toBe('42');
    expect(requireId(42, 'Room type')).toBe('42');
    expect(optionalId(undefined, 'Room')).toBeUndefined();
    expect(optionalId(null, 'Room')).toBeUndefined();
    expect(optionalId('', 'Room')).toBeUndefined();

    expect(() => requireId('0', 'Booking')).toThrow(BadRequestException);
    expect(() => requireId('0', 'Booking')).toThrow('Booking id khong hop le.');
    expect(() => requireId('01', '')).toThrow(BadRequestException);
    expect(() => requireId('01', '')).toThrow('Id khong hop le.');
  });

  it('requires the shared authenticated actor id contract', () => {
    expect(requireActorId('7')).toBe('7');
    expect(() => requireActorId(undefined)).toThrow(UnauthorizedException);
    expect(() => requireActorId(undefined)).toThrow('Access token is invalid.');
    expect(() => requireActorId('0')).toThrow(UnauthorizedException);
  });

  it('parses real ISO calendar dates and rejects normalized overflows', () => {
    expect(parseIsoDate(' 2028-02-29 ')).toBe('2028-02-29');
    expect(parseIsoDate('2026-02-29')).toBeNull();
    expect(parseIsoDate('2026-13-01')).toBeNull();
    expect(parseIsoDate('09/09/2026')).toBeNull();
    expect(parseIsoDate(20260909)).toBeNull();
  });

  it('calculates the current calendar date using the Vietnam UTC+7 offset', () => {
    expect(currentVietnamDate(new Date('2026-09-08T16:59:59.999Z'))).toBe(
      '2026-09-08',
    );
    expect(currentVietnamDate(new Date('2026-09-08T17:00:00.000Z'))).toBe(
      '2026-09-09',
    );
  });

  it('normalizes optional and required string-enum values', () => {
    const values = { READY: 'READY', HIDDEN: 'HIDDEN' } as const;

    expect(optionalEnumValue(undefined, values, 'invalid')).toBeUndefined();
    expect(optionalEnumValue('READY', values, 'invalid')).toBe('READY');
    expect(requireEnumValue('HIDDEN', values, 'invalid')).toBe('HIDDEN');
    expect(() => optionalEnumValue('UNKNOWN', values, 'invalid')).toThrow(
      BadRequestException,
    );
    expect(() => optionalEnumValue('UNKNOWN', values, 'invalid')).toThrow(
      'invalid',
    );
    expect(() => requireEnumValue('', values, 'required')).toThrow(
      BadRequestException,
    );
    expect(() => requireEnumValue('', values, 'required')).toThrow('required');
  });

  it('enforces the shared password policy', () => {
    expect(() => requirePassword('1234567')).toThrow(BadRequestException);
    expect(requirePassword('12345678')).toBe('12345678');
  });

  it('normalizes decimal amounts without floating point conversion', () => {
    expect(requireDecimalAmount('0', 'invalid')).toBe('0.00');
    expect(requireDecimalAmount('125000.5', 'invalid')).toBe('125000.50');
    expect(requireDecimalAmount(150000, 'invalid')).toBe('150000.00');
  });

  it('rejects negative, over-precision, and oversized amounts', () => {
    expect(() => requireDecimalAmount('-1', 'invalid')).toThrow(
      BadRequestException,
    );
    expect(() => requireDecimalAmount('1.999', 'invalid')).toThrow(
      BadRequestException,
    );
    expect(() => requireDecimalAmount('10000000000.00', 'invalid')).toThrow(
      BadRequestException,
    );
  });

  it('rejects zero for persisted positive-price fields', () => {
    expect(() => requirePositiveDecimalAmount('0', 'invalid')).toThrow(
      BadRequestException,
    );
    expect(requirePositiveDecimalAmount('0.01', 'invalid')).toBe('0.01');
  });

  it('parses positive integers and boolean query values', () => {
    expect(requirePositiveInt('3', 'invalid')).toBe(3);
    expect(() => requirePositiveInt(0, 'invalid')).toThrow(BadRequestException);
    expect(parseBoolean('true', false, 'invalid')).toBe(true);
    expect(parseBoolean('0', true, 'invalid')).toBe(false);
  });

  it('normalizes shared account statuses', () => {
    expect(requireAccountStatus('ACTIVE')).toBe('ACTIVE');
    expect(optionalAccountStatus('LOCKED')).toBe('LOCKED');
    expect(optionalAccountStatus(undefined)).toBeUndefined();
    expect(() => requireAccountStatus('DISABLED')).toThrow(BadRequestException);
  });

  it.each([
    '0705840355',
    '0705 840 355',
    '0705-840-355',
    '84705840355',
    '+84705840355',
  ])('normalizes Vietnamese phone %s to E.164', (phone) => {
    expect(normalizePhone(phone)).toBe('+84705840355');
  });

  it.each([
    '',
    '070584035',
    '07058403555',
    '07058abc55',
    '0205840355',
    '+12025550123',
  ])('rejects invalid Vietnamese phone %s', (phone) => {
    expect(normalizePhone(phone)).toBeNull();
  });

  it('provides canonical and legacy lookup variants', () => {
    expect(getPhoneLookupVariants('+84705840355')).toEqual([
      '+84705840355',
      '0705840355',
      '84705840355',
    ]);
  });
});
