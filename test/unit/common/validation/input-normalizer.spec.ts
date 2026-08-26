import { BadRequestException } from '@nestjs/common';

import {
  getVietnamesePhoneLookupVariants,
  normalizePhone,
  optionalAccountStatus,
  parseBoolean,
  requireAccountStatus,
  requireDecimalAmount,
  requirePositiveDecimalAmount,
  requirePassword,
  requirePositiveInt,
} from '../../../../src/common/validation/input-normalizer';

describe('input normalizer', () => {
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
    expect(getVietnamesePhoneLookupVariants('+84705840355')).toEqual([
      '+84705840355',
      '0705840355',
      '84705840355',
    ]);
  });
});
