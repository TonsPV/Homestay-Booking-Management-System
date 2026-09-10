import { assertSeedEnv } from '../../../../src/database/seeds/seed-admin';

describe('seed admin safety', () => {
  it('allows non-production environments', () => {
    expect(() => assertSeedEnv('development', false)).not.toThrow();
    expect(() => assertSeedEnv('test', false)).not.toThrow();
  });

  it('requires an explicit flag in production', () => {
    expect(() => assertSeedEnv(' Production ', false)).toThrow(
      'without --allow-production',
    );
    expect(() => assertSeedEnv('production', true)).not.toThrow();
  });
});
