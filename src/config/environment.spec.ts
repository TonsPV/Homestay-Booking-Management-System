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
    expect(config.BOOKING_PAYMENT_TIMEOUT_MINUTES).toBe(15);
    expect(config.ROOM_IMAGE_UPLOAD_DIR).toBe('.data/uploads/room-images');
    expect(config.CORS_ORIGINS).toEqual([]);
    expect(config.VNPAY_FRONTEND_RETURN_URL).toBe('');
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

  it('validates the booking payment timeout', () => {
    const config = validateEnvironment({
      JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
      BOOKING_PAYMENT_TIMEOUT_MINUTES: '30',
    });

    expect(config.BOOKING_PAYMENT_TIMEOUT_MINUTES).toBe(30);
    expect(() =>
      validateEnvironment({
        JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
        BOOKING_PAYMENT_TIMEOUT_MINUTES: '0',
      }),
    ).toThrow(
      'BOOKING_PAYMENT_TIMEOUT_MINUTES must be an integer from 1 to 1440.',
    );
  });

  it('requires VNPay credentials only when VNPay is enabled', () => {
    const disabledConfig = validateEnvironment({
      JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
    });

    expect(disabledConfig.VNPAY_ENABLED).toBe(false);
    expect(() =>
      validateEnvironment({
        JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
        VNPAY_ENABLED: 'true',
      }),
    ).toThrow('VNPAY_TMN_CODE must contain exactly 8 alphanumeric characters.');

    const enabledConfig = validateEnvironment({
      JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
      VNPAY_ENABLED: 'true',
      VNPAY_TMN_CODE: 'TEST0001',
      VNPAY_HASH_SECRET: 'test-vnpay-secret-at-least-16-characters',
    });

    expect(enabledConfig.VNPAY_ENABLED).toBe(true);
    expect(enabledConfig.VNPAY_TMN_CODE).toBe('TEST0001');

    expect(() =>
      validateEnvironment({
        JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
        VNPAY_FRONTEND_RETURN_URL: 'not-a-url',
      }),
    ).toThrow('VNPAY_FRONTEND_RETURN_URL must be a valid HTTP URL.');
  });

  it('normalizes and validates CORS origins', () => {
    const config = validateEnvironment({
      JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
      CORS_ORIGINS:
        ' http://localhost:5173,https://staff.example.com,http://localhost:5173 ',
    });

    expect(config.CORS_ORIGINS).toEqual([
      'http://localhost:5173',
      'https://staff.example.com',
    ]);
    expect(() =>
      validateEnvironment({
        JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
        CORS_ORIGINS: 'https://staff.example.com/path',
      }),
    ).toThrow('Invalid CORS origin');
  });

  it('requires deployable CORS and VNPay URLs in production', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: ' Production ',
        JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
      }),
    ).toThrow('CORS_ORIGINS is required in production.');

    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
        CORS_ORIGINS: 'https://app.example.com',
        VNPAY_ENABLED: 'true',
        VNPAY_TMN_CODE: 'TEST0001',
        VNPAY_HASH_SECRET: 'test-vnpay-secret-at-least-16-characters',
      }),
    ).toThrow('VNPAY_RETURN_URL must be a public HTTPS URL in production.');

    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
        CORS_ORIGINS: 'https://app.example.com',
        VNPAY_ENABLED: 'true',
        VNPAY_TMN_CODE: 'TEST0001',
        VNPAY_HASH_SECRET: 'test-vnpay-secret-at-least-16-characters',
        VNPAY_RETURN_URL:
          'https://api.example.com/api/v1/payments/vnpay/return',
        VNPAY_FRONTEND_RETURN_URL: 'http://localhost:5173/payment-result',
      }),
    ).toThrow(
      'VNPAY_FRONTEND_RETURN_URL must be a public HTTPS URL in production.',
    );

    const config = validateEnvironment({
      NODE_ENV: ' Production ',
      JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
      CORS_ORIGINS: 'https://app.example.com',
      VNPAY_ENABLED: 'true',
      VNPAY_TMN_CODE: 'TEST0001',
      VNPAY_HASH_SECRET: 'test-vnpay-secret-at-least-16-characters',
      VNPAY_RETURN_URL: 'https://api.example.com/api/v1/payments/vnpay/return',
      VNPAY_FRONTEND_RETURN_URL: 'https://app.example.com/payment-result',
    });

    expect(config.NODE_ENV).toBe('production');
    expect(config.CORS_ORIGINS).toEqual(['https://app.example.com']);
    expect(config.VNPAY_FRONTEND_RETURN_URL).toBe(
      'https://app.example.com/payment-result',
    );
  });
});
