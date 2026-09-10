import type {
  RoomTypeResponse,
  AdminRoomTypeResponse,
} from '../room-type.types';

import {
  optionalNullableTrimmedString,
  optionalTrimmedString,
  requireTrimmedString,
} from '../../../common/validation';

import type { Amenity } from '../../amenity/schema/amenity.entity';
import { sortBedConfigs, type BedConfig } from '../bed-configuration';
import type { CreateRoomTypeDto } from '../dto/create-room-type.dto';
import type { UpdateRoomTypeDto } from '../dto/update-room-type.dto';
import {
  assertRoomTypeUpdateHasChanges,
  assertSingleBedInputMode,
  normalizeBedConfigurations,
  optionalRoomTypeBasePrice,
  optionalRoomTypeCapacity,
  requireRoomTypeBasePrice,
  requireRoomTypeCapacity,
} from '../domain/room-type.policy';
import type { RoomType } from '../schema/room-type.entity';

export interface NormalizedCreateRoomType {
  name: string;
  description: string | null;
  bedType: string | null;
  beds: BedConfig[] | undefined;
  maxGuests: number;
  basePrice: string;
}

export interface NormalizedUpdateRoomType {
  name: string | undefined;
  description: string | null | undefined;
  bedType: string | null | undefined;
  beds: BedConfig[] | undefined;
  maxGuests: number | undefined;
  basePrice: string | undefined;
}

export interface RoomTypeBedPersistenceInput {
  roomTypeId: string;
  bedType: BedConfig['type'];
  quantity: number;
}

export function toRoomTypeEntityInput(
  input: NormalizedCreateRoomType,
): Omit<NormalizedCreateRoomType, 'beds'> {
  return {
    name: input.name,
    description: input.description,
    bedType: input.bedType,
    maxGuests: input.maxGuests,
    basePrice: input.basePrice,
  };
}

export function normalizeCreateRoomType(
  body: CreateRoomTypeDto,
): NormalizedCreateRoomType {
  assertSingleBedInputMode(body.bedType, body.beds);

  return {
    name: requireTrimmedString(body.name, 'Ten loai phong khong hop le.', 120),
    description:
      optionalNullableTrimmedString(
        body.description,
        'Mo ta khong hop le.',
        10000,
      ) ?? null,
    bedType:
      optionalNullableTrimmedString(
        body.bedType,
        'Loai giuong khong hop le.',
        120,
      ) ?? null,
    beds: normalizeBedConfigurations(body.beds),
    maxGuests: requireRoomTypeCapacity(body.maxGuests),
    basePrice: requireRoomTypeBasePrice(body.basePrice),
  };
}

export function normalizeUpdateRoomType(
  body: UpdateRoomTypeDto,
): NormalizedUpdateRoomType {
  assertSingleBedInputMode(body.bedType, body.beds);
  const normalized = {
    name: optionalTrimmedString(body.name, 'Ten loai phong khong hop le.', 120),
    description: optionalNullableTrimmedString(
      body.description,
      'Mo ta khong hop le.',
      10000,
    ),
    bedType: optionalNullableTrimmedString(
      body.bedType,
      'Loai giuong khong hop le.',
      120,
    ),
    beds: normalizeBedConfigurations(body.beds),
    maxGuests: optionalRoomTypeCapacity(body.maxGuests),
    basePrice: optionalRoomTypeBasePrice(body.basePrice),
  };

  assertRoomTypeUpdateHasChanges(Object.values(normalized));
  return normalized;
}

export function applyRoomTypeUpdate(
  roomType: RoomType,
  input: NormalizedUpdateRoomType,
): RoomType {
  if (input.name !== undefined) roomType.name = input.name;
  if (input.description !== undefined) roomType.description = input.description;
  if (input.bedType !== undefined) roomType.bedType = input.bedType;
  if (input.maxGuests !== undefined) roomType.maxGuests = input.maxGuests;
  if (input.basePrice !== undefined) roomType.basePrice = input.basePrice;

  return roomType;
}

export function buildRoomTypeBedPersistenceInputs(
  roomTypeId: string,
  beds: BedConfig[],
): RoomTypeBedPersistenceInput[] {
  return beds.map((bed) => ({
    roomTypeId,
    bedType: bed.type,
    quantity: bed.quantity,
  }));
}

export function sortNumericIds(ids: string[]): string[] {
  return [...ids].sort(
    (left, right) => left.length - right.length || left.localeCompare(right),
  );
}

export function sortAmenitiesByName(amenities: Amenity[]): Amenity[] {
  return [...amenities].sort((left, right) =>
    left.name.localeCompare(right.name),
  );
}

export function getDeletedAmenityIds(amenities: Amenity[]): string[] {
  return amenities
    .filter((amenity) => amenity.deletedAt !== null)
    .map((amenity) => amenity.id);
}

export function toPublicRoomTypeResponse(roomType: RoomType): RoomTypeResponse {
  return {
    id: roomType.id,
    name: roomType.name,
    description: roomType.description,
    bedType: roomType.bedType,
    beds: sortBedConfigs(
      (roomType.beds ?? []).map((bed) => ({
        type: bed.bedType,
        quantity: bed.quantity,
      })),
    ),
    maxGuests: roomType.maxGuests,
    basePrice: roomType.basePrice,
    amenities: (roomType.amenities ?? []).map((amenity) => ({
      id: amenity.id,
      name: amenity.name,
      description: amenity.description,
    })),
    createdAt: roomType.createdAt,
    updatedAt: roomType.updatedAt,
  };
}

export function toAdminRoomTypeResponse(
  roomType: RoomType,
): AdminRoomTypeResponse {
  return {
    ...toPublicRoomTypeResponse(roomType),
    deletedAt: roomType.deletedAt,
  };
}
