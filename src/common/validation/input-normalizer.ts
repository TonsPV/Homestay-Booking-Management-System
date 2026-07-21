import { BadRequestException } from '@nestjs/common';

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

  if (value.trim().length === 0 || value.length < 5 || value.length > 72) {
    throw new BadRequestException('Mat khau phai tu 5 den 72 ky tu.');
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

export function isEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizePhone(value: string): string | null {
  const normalized = value.trim().replace(/[().\-\s]/g, '');

  if (!/^\+?[0-9]{7,20}$/.test(normalized)) {
    return null;
  }

  return normalized;
}
