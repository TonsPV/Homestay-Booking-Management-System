import { validateEnvironment } from './environment';

describe('validateEnvironment', () => {
  it('requires a sufficiently long JWT secret', () => {
    expect(() => validateEnvironment({})).toThrow(
      'JWT_ACCESS_TOKEN_SECRET is required.',
    );
    expect(() =>
      validateEnvironment({ JWT_ACCESS_TOKEN_SECRET: 'too-short' }),
    ).toThrow('JWT_ACCESS_TOKEN_SECRET must be at least 32 characters.');
  });

  it('normalizes the default token duration', () => {
    const config = validateEnvironment({
      JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
    });

    expect(config.JWT_ACCESS_TOKEN_EXPIRES_IN).toBe('1h');
  });

  it('rejects known example secrets', () => {
    expect(() =>
      validateEnvironment({
        JWT_ACCESS_TOKEN_SECRET: 'replace_with_a_long_random_secret',
      }),
    ).toThrow('JWT_ACCESS_TOKEN_SECRET must be replaced with a random secret.');
  });

  it('rejects invalid or zero token durations', () => {
    expect(() =>
      validateEnvironment({
        JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
        JWT_ACCESS_TOKEN_EXPIRES_IN: 'forever',
      }),
    ).toThrow('JWT_ACCESS_TOKEN_EXPIRES_IN must be a positive duration');

    expect(() =>
      validateEnvironment({
        JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
        JWT_ACCESS_TOKEN_EXPIRES_IN: '0h',
      }),
    ).toThrow('JWT_ACCESS_TOKEN_EXPIRES_IN must be a positive duration');
  });
});
