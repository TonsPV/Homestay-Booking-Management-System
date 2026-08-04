import { assertSeedAdminEnvironment } from './seed-admin';

describe('seed admin safety', () => {
  it('allows non-production environments', () => {
    expect(() =>
      assertSeedAdminEnvironment('development', false),
    ).not.toThrow();
    expect(() => assertSeedAdminEnvironment('test', false)).not.toThrow();
  });

  it('requires an explicit flag in production', () => {
    expect(() => assertSeedAdminEnvironment(' Production ', false)).toThrow(
      'without --allow-production',
    );
    expect(() => assertSeedAdminEnvironment('production', true)).not.toThrow();
  });
});
