import { BadRequestException, HttpStatus } from '@nestjs/common';

import { ErrorCode } from '../../../../src/common/error-codes';
import { AppHttpException } from '../../../../src/common/http/app-http-exception';
import { BedType } from '../../../../src/module/room-type/bed-configuration';
import {
  assertRoomTypeNotInUse,
  normalizeBedConfigurations,
  requireAmenityIds,
  requireRoomTypeBasePrice,
  requireRoomTypeCapacity,
} from '../../../../src/module/room-type/domain/room-type.policy';

describe('room type policy', () => {
  it('normalizes and deterministically sorts valid bed configurations', () => {
    expect(
      normalizeBedConfigurations([
        { type: BedType.KING, quantity: 1 },
        { type: BedType.SINGLE, quantity: 2 },
      ]),
    ).toEqual([
      { type: BedType.SINGLE, quantity: 2 },
      { type: BedType.KING, quantity: 1 },
    ]);
  });

  it('preserves duplicate and invalid bed errors', () => {
    expect(() =>
      normalizeBedConfigurations([
        { type: BedType.DOUBLE, quantity: 1 },
        { type: BedType.DOUBLE, quantity: 2 },
      ]),
    ).toThrow('Moi loai giuong chi duoc xuat hien mot lan.');
    expect(() =>
      normalizeBedConfigurations([{ type: BedType.DOUBLE, quantity: 0 }]),
    ).toThrow('So luong giuong khong hop le.');
  });

  it('keeps capacity and price normalization boundaries', () => {
    expect(requireRoomTypeCapacity(100)).toBe(100);
    expect(requireRoomTypeBasePrice('1250000.5')).toBe('1250000.50');
    expect(() => requireRoomTypeCapacity(101)).toThrow(BadRequestException);
    expect(() => requireRoomTypeBasePrice('0')).toThrow(BadRequestException);
  });

  it('normalizes amenity IDs and rejects duplicates', () => {
    expect(requireAmenityIds([2, '1'])).toEqual(['2', '1']);
    expect(() => requireAmenityIds(['1', '1'])).toThrow(
      'Amenity id khong duoc trung lap.',
    );
  });

  it('preserves the in-use deletion error contract', () => {
    try {
      assertRoomTypeNotInUse(true);
      throw new Error('Expected policy to reject deletion.');
    } catch (error) {
      expect(error).toBeInstanceOf(AppHttpException);
      expect(error).toMatchObject({
        status: HttpStatus.CONFLICT,
        message: 'Khong the xoa loai phong dang duoc phong su dung.',
      });
      expect((error as AppHttpException).getResponse()).toMatchObject({
        errorCode: ErrorCode.ROOM_TYPE_IN_USE,
      });
    }
  });
});
