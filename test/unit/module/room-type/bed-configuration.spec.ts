import {
  BedType,
  parseLegacyBedType,
  sortBedConfigurations,
} from '../../../../src/module/room-type/bed-configuration';

describe('bed configuration parser', () => {
  it.each([
    ['1 giường đôi', [{ type: BedType.DOUBLE, quantity: 1 }]],
    ['2 giường đơn', [{ type: BedType.SINGLE, quantity: 2 }]],
    [
      '1 giường đôi và 1 giường đơn',
      [
        { type: BedType.SINGLE, quantity: 1 },
        { type: BedType.DOUBLE, quantity: 1 },
      ],
    ],
    ['Giường đôi', [{ type: BedType.DOUBLE, quantity: 1 }]],
    ['Queen bed', [{ type: BedType.QUEEN, quantity: 1 }]],
    ['King', [{ type: BedType.KING, quantity: 1 }]],
  ])('parses known legacy phrase %s', (input, expected) => {
    expect(parseLegacyBedType(input)).toEqual(expected);
  });

  it.each(['1 giường đôi hướng biển', 'custom text', '', '3 giường'])(
    'does not guess unknown text: %s',
    (input) => {
      expect(parseLegacyBedType(input)).toBeNull();
    },
  );

  it('sorts configurations by the stable domain order', () => {
    expect(
      sortBedConfigurations([
        { type: BedType.SOFA_BED, quantity: 1 },
        { type: BedType.SINGLE, quantity: 1 },
        { type: BedType.DOUBLE, quantity: 1 },
      ]),
    ).toEqual([
      { type: BedType.SINGLE, quantity: 1 },
      { type: BedType.DOUBLE, quantity: 1 },
      { type: BedType.SOFA_BED, quantity: 1 },
    ]);
  });
});
