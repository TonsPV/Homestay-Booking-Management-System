import {
  createPhoneNormalizationPlan,
  isProductionEnvironment,
} from '../../../../src/database/scripts/phone-normalization';

describe('createPhoneNormalizationPlan', () => {
  it('plans canonical updates without changing null phones', () => {
    const plan = createPhoneNormalizationPlan([
      { source: 'users', id: '1', phone: '0705 840 355' },
      { source: 'users', id: '2', phone: null },
      { source: 'customers', id: '3', phone: '+84858501102' },
    ]);

    expect(plan).toEqual({
      changes: [
        {
          source: 'users',
          id: '1',
          currentPhone: '0705 840 355',
          normalizedPhone: '+84705840355',
        },
      ],
      invalidRecords: [],
      collisions: [],
    });
  });

  it('detects invalid values and canonical collisions before writing', () => {
    const plan = createPhoneNormalizationPlan([
      { source: 'customers', id: '1', phone: '0705840355' },
      { source: 'customers', id: '2', phone: '+84705840355' },
      { source: 'users', id: '3', phone: 'not-a-phone' },
    ]);

    expect(plan.invalidRecords).toEqual([
      { source: 'users', id: '3', phone: 'not-a-phone' },
    ]);
    expect(plan.collisions).toEqual([
      {
        source: 'customers',
        normalizedPhone: '+84705840355',
        ids: ['1', '2'],
      },
    ]);
  });

  it('recognizes production regardless of casing or surrounding spaces', () => {
    expect(isProductionEnvironment(' Production ')).toBe(true);
    expect(isProductionEnvironment('development')).toBe(false);
    expect(isProductionEnvironment(undefined)).toBe(false);
  });
});
