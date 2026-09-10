import { BedType } from '../../../../src/module/room-type/bed-configuration';
import {
  applyRoomTypeUpdate,
  buildRoomTypeBedPersistenceInputs,
  normalizeCreateRoomType,
  normalizeUpdateRoomType,
  sortNumericIds,
  toAdminRoomTypeResponse,
} from '../../../../src/module/room-type/mappers/room-type.mapper';
import type { RoomTypeBed } from '../../../../src/module/room-type/schema/room-type-bed.entity';
import type { RoomType } from '../../../../src/module/room-type/schema/room-type.entity';

describe('room type mapper', () => {
  it('normalizes create payload fields', () => {
    expect(
      normalizeCreateRoomType({
        name: '  Deluxe ',
        description: '  Sea view ',
        maxGuests: 4,
        basePrice: '1250000.5',
        beds: [{ type: BedType.DOUBLE, quantity: 2 }],
      }),
    ).toEqual({
      name: 'Deluxe',
      description: 'Sea view',
      bedType: null,
      beds: [{ type: BedType.DOUBLE, quantity: 2 }],
      maxGuests: 4,
      basePrice: '1250000.50',
    });
  });

  it('normalizes and applies only supplied update fields', () => {
    const roomType = roomTypeFixture();
    const input = normalizeUpdateRoomType({
      description: null,
      maxGuests: 6,
    });

    expect(applyRoomTypeUpdate(roomType, input)).toMatchObject({
      name: 'Deluxe',
      description: null,
      maxGuests: 6,
      basePrice: '1000000.00',
    });
  });

  it('builds bed persistence rows and sorts numeric IDs', () => {
    expect(
      buildRoomTypeBedPersistenceInputs('10', [
        { type: BedType.QUEEN, quantity: 2 },
      ]),
    ).toEqual([{ roomTypeId: '10', bedType: BedType.QUEEN, quantity: 2 }]);
    expect(sortNumericIds(['10', '2', '1'])).toEqual(['1', '2', '10']);
  });

  it('formats the admin response with deterministic bed order', () => {
    const deletedAt = new Date('2030-01-01T00:00:00.000Z');
    const response = toAdminRoomTypeResponse(
      roomTypeFixture({
        deletedAt,
        beds: [
          { bedType: BedType.KING, quantity: 1 } as RoomTypeBed,
          { bedType: BedType.SINGLE, quantity: 2 } as RoomTypeBed,
        ],
      }),
    );

    expect(response).toMatchObject({
      id: '1',
      beds: [
        { type: BedType.SINGLE, quantity: 2 },
        { type: BedType.KING, quantity: 1 },
      ],
      amenities: [],
      deletedAt,
    });
  });
});

function roomTypeFixture(overrides: Partial<RoomType> = {}): RoomType {
  return {
    id: '1',
    name: 'Deluxe',
    description: 'Sea view',
    bedType: null,
    beds: [],
    maxGuests: 4,
    basePrice: '1000000.00',
    amenities: [],
    createdAt: new Date('2029-01-01T00:00:00.000Z'),
    updatedAt: new Date('2029-01-02T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}
