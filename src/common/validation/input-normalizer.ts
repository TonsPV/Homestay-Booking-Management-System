import { BadRequestException } from '@nestjs/common';

import { AccountStatusEnum, type AccountStatus } from '../domain/account.enums';

export function requireTrimmedString(
  value: unknown,
  message: string,
  maxLength?: number,
): string {
  if (typeof value !== 'string') {
    throw new BadRequestException(message);
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    throw new BadRequestException(message);
  }

  if (maxLength !== undefined && trimmed.length > maxLength) {
    throw new BadRequestException(message);
  }

  return trimmed;
}

export function optionalTrimmedString(
  value: unknown,
  message: string,
  maxLength?: number,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireTrimmedString(value, message, maxLength);
}

export function optionalNullableTrimmedString(
  value: unknown,
  message: string,
  maxLength?: number,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === '') {
    return null;
  }

  return requireTrimmedString(value, message, maxLength);
}

export function requireEmail(value: unknown): string {
  const email = requireTrimmedString(
    value,
    'Email khong hop le.',
    160,
  ).toLowerCase();

  if (!isEmail(email)) {
    throw new BadRequestException('Email khong hop le.');
  }

  return email;
}

export function optionalEmail(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireEmail(value);
}

export function optionalNullableEmail(
  value: unknown,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === '') {
    return null;
  }

  return requireEmail(value);
}

export function requiredPhone(value: unknown): string {
  if (typeof value !== 'string') {
    throw new BadRequestException('So dien thoai khong hop le.');
  }

  const phone = normalizePhone(value);

  if (phone === null) {
    throw new BadRequestException('So dien thoai khong hop le.');
  }

  return phone;
}

export function optionalNullablePhone(
  value: unknown,
): string | null | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (value === null || value === '') {
    return null;
  }

  return requiredPhone(value);
}

export function requirePassword(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new BadRequestException('Mat khau la bat buoc.');
  }

  if (value.trim().length === 0 || value.length < 8 || value.length > 72) {
    throw new BadRequestException('Mat khau phai tu 8 den 72 ky tu.');
  }

  return value;
}

export function requireLoginPassword(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.trim().length === 0
  ) {
    throw new BadRequestException('Mat khau la bat buoc.');
  }

  return value;
}

export function optionalPassword(value: unknown): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requirePassword(value);
}

export function parsePagination(query: Record<string, unknown>): {
  page: number;
  limit: number;
  skip: number;
} {
  const page = parsePositiveInt(query.page, 1, 1, 100000, 'Page khong hop le.');
  const limit = parsePositiveInt(
    query.limit,
    20,
    1,
    100,
    'Limit khong hop le.',
  );

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
}

export function optionalSearch(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  return requireTrimmedString(value, 'Tu khoa tim kiem khong hop le.', 160);
}

export function parsePositiveInt(
  value: unknown,
  defaultValue: number,
  min: number,
  max: number,
  message: string,
): number {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  let numberValue: number;

  if (typeof value === 'number') {
    numberValue = value;
  } else if (typeof value === 'string') {
    numberValue = Number(value);
  } else {
    throw new BadRequestException(message);
  }

  if (
    !Number.isInteger(numberValue) ||
    numberValue < min ||
    numberValue > max
  ) {
    throw new BadRequestException(message);
  }

  return numberValue;
}

export function requirePositiveInt(
  value: unknown,
  message: string,
  max = 2147483647,
): number {
  if (value === undefined || value === null || value === '') {
    throw new BadRequestException(message);
  }

  return parsePositiveInt(value, 1, 1, max, message);
}

export function requireDecimalAmount(value: unknown, message: string): string {
  let rawValue: string;

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new BadRequestException(message);
    }

    rawValue = String(value);
  } else if (typeof value === 'string') {
    rawValue = value.trim();
  } else {
    throw new BadRequestException(message);
  }

  const match = /^(0|[1-9][0-9]{0,9})(?:[.]([0-9]{1,2}))?$/.exec(rawValue);

  if (match === null) {
    throw new BadRequestException(message);
  }

  return `${match[1]}.${(match[2] ?? '').padEnd(2, '0')}`;
}

export function optionalDecimalAmount(
  value: unknown,
  message: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requireDecimalAmount(value, message);
}

/** Normalize a persisted money amount and reject the legacy zero value. */
export function requirePositiveDecimalAmount(
  value: unknown,
  message: string,
): string {
  const amount = requireDecimalAmount(value, message);

  if (amount === '0.00') {
    throw new BadRequestException(message);
  }

  return amount;
}

export function optionalPositiveDecimalAmount(
  value: unknown,
  message: string,
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return requirePositiveDecimalAmount(value, message);
}

export function parseBoolean(
  value: unknown,
  defaultValue: boolean,
  message: string,
): boolean {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  if (value === true || value === 'true' || value === '1') {
    return true;
  }

  if (value === false || value === 'false' || value === '0') {
    return false;
  }

  throw new BadRequestException(message);
}

export function optionalAccountStatus(
  value: unknown,
  message = 'Trang thai tai khoan khong hop le.',
): AccountStatus | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (
    typeof value !== 'string' ||
    !Object.values(AccountStatusEnum).includes(value as AccountStatusEnum)
  ) {
    throw new BadRequestException(message);
  }

  return value as AccountStatus;
}

export function requireAccountStatus(
  value: unknown,
  message = 'Trang thai tai khoan khong hop le.',
): AccountStatus {
  const status = optionalAccountStatus(value, message);

  if (status === undefined) {
    throw new BadRequestException(message);
  }

  return status;
}

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function normalizePhone(value: string): string | null {
  const compact = value.trim().replace(/[().\-\s]/g, '');

  if (!/^\+?[0-9]+$/.test(compact)) {
    return null;
  }

  let subscriberNumber: string;

  if (compact.startsWith('+84')) {
    subscriberNumber = compact.slice(3);
  } else if (compact.startsWith('84')) {
    subscriberNumber = compact.slice(2);
  } else if (compact.startsWith('0')) {
    subscriberNumber = compact.slice(1);
  } else {
    return null;
  }

  if (!/^[35789][0-9]{8}$/.test(subscriberNumber)) {
    return null;
  }

  return `+84${subscriberNumber}`;
}

export function getPhoneLookupVariants(normalizedPhone: string): string[] {
  if (!/^\+84[35789][0-9]{8}$/.test(normalizedPhone)) {
    return [normalizedPhone];
  }

  return [
    normalizedPhone,
    `0${normalizedPhone.slice(3)}`,
    normalizedPhone.slice(1),
  ];
}
