import {
  BadRequestException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';

import { ErrorCode } from '../../../common/error-codes';
import { AppHttpException } from '../../../common/http/app-http-exception';
import {
  isEnumValue,
  optionalPositiveDecimalAmount,
  requireId,
  requirePositiveDecimalAmount,
  requirePositiveInt,
} from '../../../common/validation';
import type { Amenity } from '../../amenity/schema/amenity.entity';
import {
  BedType,
  MAX_BED_QUANTITY,
  MAX_BED_TYPES,
  sortBedConfigs,
  type BedConfig,
} from '../bed-configuration';
import type { RoomType } from '../schema/room-type.entity';

export function assertSingleBedInputMode(
  legacyValue: unknown,
  normalizedValue: unknown,
): void {
  if (legacyValue !== undefined && normalizedValue !== undefined) {
    throw new BadRequestException(
      'Khong the gui dong thoi bedType va beds. Hay dung beds.',
    );
  }
}

export function normalizeBedConfigurations(
  value: unknown,
): BedConfig[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.length > MAX_BED_TYPES) {
    throw new BadRequestException(
      `beds phai la mang toi da ${MAX_BED_TYPES} phan tu.`,
    );
  }

  const seenTypes = new Set<BedType>();
  const beds: BedConfig[] = [];

  for (const rawBed of value) {
    if (
      rawBed === null ||
      typeof rawBed !== 'object' ||
      Array.isArray(rawBed)
    ) {
      throw new BadRequestException('Cau hinh giuong khong hop le.');
    }

    const bedRecord = rawBed as Record<string, unknown>;
    const unknownKeys = Object.keys(bedRecord).filter(
      (key) => key !== 'type' && key !== 'quantity',
    );

    if (unknownKeys.length > 0) {
      throw new BadRequestException('Cau hinh giuong khong hop le.');
    }

    const bedTypeValue = bedRecord.type;
    const bedQuantity = bedRecord.quantity;

    if (!isEnumValue(BedType, bedTypeValue)) {
      throw new BadRequestException('Loai giuong khong hop le.');
    }

    if (
      typeof bedQuantity !== 'number' ||
      !Number.isSafeInteger(bedQuantity) ||
      bedQuantity < 1 ||
      bedQuantity > MAX_BED_QUANTITY
    ) {
      throw new BadRequestException('So luong giuong khong hop le.');
    }

    if (seenTypes.has(bedTypeValue)) {
      throw new BadRequestException(
        'Moi loai giuong chi duoc xuat hien mot lan.',
      );
    }

    seenTypes.add(bedTypeValue);
    beds.push({ type: bedTypeValue, quantity: bedQuantity });
  }

  return sortBedConfigs(beds);
}

export function requireRoomTypeCapacity(value: unknown): number {
  return requirePositiveInt(value, 'So khach toi da khong hop le.', 100);
}

export function optionalRoomTypeCapacity(value: unknown): number | undefined {
  return value === undefined ? undefined : requireRoomTypeCapacity(value);
}

export function requireRoomTypeBasePrice(value: unknown): string {
  return requirePositiveDecimalAmount(value, 'Gia co ban khong hop le.');
}

export function optionalRoomTypeBasePrice(value: unknown): string | undefined {
  return optionalPositiveDecimalAmount(value, 'Gia co ban khong hop le.');
}

export function assertRoomTypeUpdateHasChanges(
  values: ReadonlyArray<unknown>,
): void {
  if (values.every((value) => value === undefined)) {
    throw new BadRequestException('Khong co du lieu de cap nhat.');
  }
}

export function requireAmenityIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 50) {
    throw new BadRequestException(
      'Danh sach amenityIds phai la mang toi da 50 phan tu.',
    );
  }

  const ids = value.map((item) => requireId(String(item), 'Amenity'));

  if (new Set(ids).size !== ids.length) {
    throw new BadRequestException('Amenity id khong duoc trung lap.');
  }

  return ids;
}

export function assertActiveAmenities(
  amenities: Amenity[],
  expectedCount: number,
): void {
  if (
    amenities.length !== expectedCount ||
    amenities.some((amenity) => amenity.deletedAt !== null)
  ) {
    throw new BadRequestException(
      'Danh sach tien nghi chua id khong ton tai hoac da bi xoa.',
    );
  }
}

export function assertAllAmenitiesFound(
  amenities: Amenity[],
  expectedCount: number,
): void {
  if (amenities.length !== expectedCount) {
    throw new NotFoundException('Khong tim thay tien nghi cua loai phong.');
  }
}

export function requireActiveRoomType(roomType: RoomType | null): RoomType {
  if (roomType === null || roomType.deletedAt !== null) {
    throw new NotFoundException('Khong tim thay loai phong.');
  }

  return roomType;
}

export function requireDeletedRoomType(roomType: RoomType | null): RoomType {
  if (roomType === null) {
    throw new NotFoundException('Khong tim thay loai phong.');
  }

  if (roomType.deletedAt === null) {
    throw new BadRequestException('Loai phong chua bi xoa.');
  }

  return roomType;
}

export function assertRoomTypeNotInUse(hasActiveRooms: boolean): void {
  if (hasActiveRooms) {
    throw new AppHttpException(
      HttpStatus.CONFLICT,
      ErrorCode.ROOM_TYPE_IN_USE,
      'Khong the xoa loai phong dang duoc phong su dung.',
    );
  }
}
