import { validateEnvironment } from '../../../src/config/environment';

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
    expect(config.DB_POOL_SIZE).toBe(10);
    expect(config.DB_POOL_QUEUE_LIMIT).toBe(50);
    expect(config.DB_CONNECT_TIMEOUT_MS).toBe(5000);
    expect(config.BOOKING_PAYMENT_TIMEOUT_MINUTES).toBe(15);
    expect(config.BOOKING_MAX_ACTIVE_UNPAID_PER_CUSTOMER).toBe(3);
    expect(config.BOOKING_MAX_HELD_NIGHTS_PER_CUSTOMER).toBe(30);
    expect(config.BOOKING_MAX_ADVANCE_DAYS).toBe(365);
    expect(config.EXPIRATION_SCHEDULERS_ENABLED).toBe(true);
    expect(config.SWAGGER_ENABLED).toBe(true);
    expect(config.HTTP_JSON_BODY_LIMIT).toBe('1mb');
    expect(config.HTTP_URLENCODED_BODY_LIMIT).toBe('1mb');
    expect(config.CUSTOMER_CLAIM_SMS_ENABLED).toBe(false);
    expect(config.CUSTOMER_CLAIM_LOCAL_BYPASS_ENABLED).toBe(false);
    expect(config.CUSTOMER_CLAIM_SMS_PROVIDER).toBe('disabled');
    expect(config.CUSTOMER_CLAIM_OTP_LIFETIME_MINUTES).toBe(5);
    expect(config.CUSTOMER_CLAIM_OTP_MAX_ATTEMPTS).toBe(5);
    expect(config.CUSTOMER_CLAIM_OTP_RESEND_COOLDOWN_SECONDS).toBe(60);
    expect(config.CUSTOMER_CLAIM_OTP_RATE_WINDOW_MINUTES).toBe(15);
    expect(config.CUSTOMER_CLAIM_OTP_PHONE_WINDOW_LIMIT).toBe(3);
    expect(config.CUSTOMER_CLAIM_OTP_PHONE_DAILY_LIMIT).toBe(10);
    expect(config.CUSTOMER_CLAIM_OTP_IP_WINDOW_LIMIT).toBe(20);
    expect(config.CUSTOMER_CLAIM_TOKEN_LIFETIME_MINUTES).toBe(10);
    expect(config.ROOM_IMAGE_UPLOAD_DIR).toBe('.data/uploads/room-images');
    expect(config.CORS_ORIGINS).toEqual([]);
    expect(config.VNPAY_FRONTEND_RETURN_URL).toBe('');
    expect(config.VNPAY_REQUEST_TIMEOUT_MS).toBe(10_000);
  });

  it('rejects known example secrets', () => {
    for (const secret of [
      'replace_with_a_long_random_secret',
      'development-only-secret-change-before-production-2026',
    ]) {
      expect(() =>
        validateEnvironment({ JWT_ACCESS_TOKEN_SECRET: secret }),
      ).toThrow(
        'JWT_ACCESS_TOKEN_SECRET must be replaced with a random secret.',
      );
    }
  });

  it.each(['30s', '15m', '1h', '7d', '1', ' 15m '])(
    'accepts supported token duration %s',
    (duration) => {
      expect(
        validateEnvironment({
          JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
          JWT_ACCESS_TOKEN_EXPIRES_IN: duration,
        }).JWT_ACCESS_TOKEN_EXPIRES_IN,
      ).toBe(duration.trim());
    },
  );

  it.each([
    'forever',
    '0',
    '0h',
    '-1h',
    '1.5h',
    '1w',
    '1ms',
    'Infinity',
    'NaN',
    `${'9'.repeat(400)}d`,
  ])('rejects invalid token duration %s', (duration) => {
    expect(() =>
      validateEnvironment({
        JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
        JWT_ACCESS_TOKEN_EXPIRES_IN: duration,
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

  it('validates database resource bounds', () => {
    const config = validateEnvironment({
      JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
      DB_POOL_SIZE: '20',
      DB_POOL_QUEUE_LIMIT: '75',
      DB_CONNECT_TIMEOUT_MS: '2500',
    });

    expect(config.DB_POOL_SIZE).toBe(20);
    expect(config.DB_POOL_QUEUE_LIMIT).toBe(75);
    expect(config.DB_CONNECT_TIMEOUT_MS).toBe(2500);
    expect(() =>
      validateEnvironment({
        JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
        DB_POOL_QUEUE_LIMIT: '0',
      }),
    ).toThrow('DB_POOL_QUEUE_LIMIT must be an integer from 1 to 1000.');
    expect(() =>
      validateEnvironment({
        JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
        DB_CONNECT_TIMEOUT_MS: '249',
      }),
    ).toThrow('DB_CONNECT_TIMEOUT_MS must be an integer from 250 to 60000.');
  });

  it('validates booking admission limits', () => {
    const config = validateEnvironment({
      JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
      BOOKING_MAX_ACTIVE_UNPAID_PER_CUSTOMER: '4',
      BOOKING_MAX_HELD_NIGHTS_PER_CUSTOMER: '45',
      BOOKING_MAX_ADVANCE_DAYS: '730',
    });

    expect(config.BOOKING_MAX_ACTIVE_UNPAID_PER_CUSTOMER).toBe(4);
    expect(config.BOOKING_MAX_HELD_NIGHTS_PER_CUSTOMER).toBe(45);
    expect(config.BOOKING_MAX_ADVANCE_DAYS).toBe(730);
    expect(() =>
      validateEnvironment({
        JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
        BOOKING_MAX_ACTIVE_UNPAID_PER_CUSTOMER: '0',
      }),
    ).toThrow(
      'BOOKING_MAX_ACTIVE_UNPAID_PER_CUSTOMER must be an integer from 1 to 20.',
    );
    expect(() =>
      validateEnvironment({
        JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
        BOOKING_MAX_HELD_NIGHTS_PER_CUSTOMER: '366',
      }),
    ).toThrow(
      'BOOKING_MAX_HELD_NIGHTS_PER_CUSTOMER must be an integer from 1 to 365.',
    );
    expect(() =>
      validateEnvironment({
        JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
        BOOKING_MAX_ADVANCE_DAYS: '3651',
      }),
    ).toThrow('BOOKING_MAX_ADVANCE_DAYS must be an integer from 1 to 3650.');
  });

  it('validates the expiration scheduler toggle', () => {
    expect(
      validateEnvironment({
        JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
        EXPIRATION_SCHEDULERS_ENABLED: 'false',
      }).EXPIRATION_SCHEDULERS_ENABLED,
    ).toBe(false);
    expect(() =>
      validateEnvironment({
        JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
        EXPIRATION_SCHEDULERS_ENABLED: 'sometimes',
      }),
    ).toThrow('EXPIRATION_SCHEDULERS_ENABLED must be true or false.');
  });

  it('allows deterministic SMS delivery only in an enabled test environment', () => {
    const config = validateEnvironment({
      NODE_ENV: 'test',
      JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
      CUSTOMER_CLAIM_SMS_ENABLED: 'true',
      CUSTOMER_CLAIM_SMS_PROVIDER: 'test',
    });

    expect(config.CUSTOMER_CLAIM_SMS_ENABLED).toBe(true);
    expect(config.CUSTOMER_CLAIM_SMS_PROVIDER).toBe('test');

    expect(() =>
      validateEnvironment({
        NODE_ENV: 'development',
        JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
        CUSTOMER_CLAIM_SMS_ENABLED: 'true',
        CUSTOMER_CLAIM_SMS_PROVIDER: 'test',
      }),
    ).toThrow(
      'CUSTOMER_CLAIM_SMS_PROVIDER=test is allowed only when NODE_ENV=test.',
    );
  });

  it('allows local claim bypass only in development or test', () => {
    expect(
      validateEnvironment({
        NODE_ENV: 'development',
        JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
        CUSTOMER_CLAIM_LOCAL_BYPASS_ENABLED: 'true',
      }).CUSTOMER_CLAIM_LOCAL_BYPASS_ENABLED,
    ).toBe(true);
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
        CORS_ORIGINS: 'https://app.example.com',
        CUSTOMER_CLAIM_LOCAL_BYPASS_ENABLED: 'true',
      }),
    ).toThrow(
      'CUSTOMER_CLAIM_LOCAL_BYPASS_ENABLED requires explicit NODE_ENV=development or test.',
    );
    expect(() =>
      validateEnvironment({
        JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
        CUSTOMER_CLAIM_LOCAL_BYPASS_ENABLED: 'true',
      }),
    ).toThrow(
      'CUSTOMER_CLAIM_LOCAL_BYPASS_ENABLED requires explicit NODE_ENV=development or test.',
    );
  });

  it('fails closed for missing, disabled, contradictory, or unsupported SMS providers', () => {
    const secret = 'a'.repeat(32);

    expect(() =>
      validateEnvironment({
        JWT_ACCESS_TOKEN_SECRET: secret,
        CUSTOMER_CLAIM_SMS_ENABLED: 'true',
      }),
    ).toThrow('CUSTOMER_CLAIM_SMS_ENABLED requires an installed SMS provider.');
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'test',
        JWT_ACCESS_TOKEN_SECRET: secret,
        CUSTOMER_CLAIM_SMS_PROVIDER: 'test',
      }),
    ).toThrow(
      'CUSTOMER_CLAIM_SMS_PROVIDER must be disabled when CUSTOMER_CLAIM_SMS_ENABLED is false.',
    );
    expect(() =>
      validateEnvironment({
        JWT_ACCESS_TOKEN_SECRET: secret,
        CUSTOMER_CLAIM_SMS_ENABLED: 'true',
        CUSTOMER_CLAIM_SMS_PROVIDER: 'unknown-provider',
      }),
    ).toThrow('CUSTOMER_CLAIM_SMS_PROVIDER must be disabled or test');
  });

  it('validates Customer claim OTP policy bounds', () => {
    const secret = 'a'.repeat(32);
    const config = validateEnvironment({
      JWT_ACCESS_TOKEN_SECRET: secret,
      CUSTOMER_CLAIM_OTP_LIFETIME_MINUTES: '10',
      CUSTOMER_CLAIM_OTP_MAX_ATTEMPTS: '4',
      CUSTOMER_CLAIM_OTP_RESEND_COOLDOWN_SECONDS: '90',
      CUSTOMER_CLAIM_OTP_RATE_WINDOW_MINUTES: '30',
      CUSTOMER_CLAIM_OTP_PHONE_WINDOW_LIMIT: '4',
      CUSTOMER_CLAIM_OTP_PHONE_DAILY_LIMIT: '12',
      CUSTOMER_CLAIM_OTP_IP_WINDOW_LIMIT: '30',
      CUSTOMER_CLAIM_TOKEN_LIFETIME_MINUTES: '15',
    });

    expect(config.CUSTOMER_CLAIM_OTP_LIFETIME_MINUTES).toBe(10);
    expect(config.CUSTOMER_CLAIM_OTP_MAX_ATTEMPTS).toBe(4);
    expect(config.CUSTOMER_CLAIM_OTP_RESEND_COOLDOWN_SECONDS).toBe(90);
    expect(config.CUSTOMER_CLAIM_OTP_RATE_WINDOW_MINUTES).toBe(30);
    expect(config.CUSTOMER_CLAIM_OTP_PHONE_WINDOW_LIMIT).toBe(4);
    expect(config.CUSTOMER_CLAIM_OTP_PHONE_DAILY_LIMIT).toBe(12);
    expect(config.CUSTOMER_CLAIM_OTP_IP_WINDOW_LIMIT).toBe(30);
    expect(config.CUSTOMER_CLAIM_TOKEN_LIFETIME_MINUTES).toBe(15);
    expect(() =>
      validateEnvironment({
        JWT_ACCESS_TOKEN_SECRET: secret,
        CUSTOMER_CLAIM_OTP_LIFETIME_MINUTES: '16',
      }),
    ).toThrow(
      'CUSTOMER_CLAIM_OTP_LIFETIME_MINUTES must be an integer from 1 to 15.',
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
        VNPAY_REQUEST_TIMEOUT_MS: '999',
      }),
    ).toThrow(
      'VNPAY_REQUEST_TIMEOUT_MS must be an integer from 1000 to 120000.',
    );

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

  it('parses Swagger and body-parser settings without treating strings as booleans', () => {
    const config = validateEnvironment({
      JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://app.example.com',
      SWAGGER_ENABLED: 'false',
      HTTP_JSON_BODY_LIMIT: ' 2MB ',
      HTTP_URLENCODED_BODY_LIMIT: '512kb',
    });

    expect(config.SWAGGER_ENABLED).toBe(false);
    expect(config.HTTP_JSON_BODY_LIMIT).toBe('2mb');
    expect(config.HTTP_URLENCODED_BODY_LIMIT).toBe('512kb');
    expect(() =>
      validateEnvironment({
        JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
        HTTP_JSON_BODY_LIMIT: '1.5mb',
      }),
    ).toThrow('HTTP_JSON_BODY_LIMIT must be a size');
    expect(() =>
      validateEnvironment({
        JWT_ACCESS_TOKEN_SECRET: 'a'.repeat(32),
        HTTP_URLENCODED_BODY_LIMIT: '51mb',
      }),
    ).toThrow('HTTP_URLENCODED_BODY_LIMIT must be greater than zero');
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
