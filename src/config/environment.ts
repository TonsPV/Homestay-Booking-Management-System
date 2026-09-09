import { isPositiveDuration } from './duration';

const MIN_JWT_SECRET_LENGTH = 32;
const DISALLOWED_JWT_SECRETS = new Set([
  'change-this-development-access-token-secret',
  'development-only-secret-change-before-production-2026',
  'replace_with_a_long_random_secret',
]);

export function validateEnvironment(
  config: Record<string, unknown>,
): Record<string, unknown> {
  const nodeEnvironment = readString(
    config,
    'NODE_ENV',
    'development',
  ).toLowerCase();
  const secret = readRequiredString(config, 'JWT_ACCESS_TOKEN_SECRET');

  if (secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(
      `JWT_ACCESS_TOKEN_SECRET must be at least ${MIN_JWT_SECRET_LENGTH} characters.`,
    );
  }

  if (DISALLOWED_JWT_SECRETS.has(secret)) {
    throw new Error(
      'JWT_ACCESS_TOKEN_SECRET must be replaced with a random secret.',
    );
  }

  const expiresIn = readString(config, 'JWT_ACCESS_TOKEN_EXPIRES_IN', '1h');

  if (!isPositiveDuration(expiresIn)) {
    throw new Error(
      'JWT_ACCESS_TOKEN_EXPIRES_IN must be a positive duration such as 15m, 1h, or 7d.',
    );
  }

  const paymentTimeoutMinutes = readPositiveInt(
    config,
    'BOOKING_PAYMENT_TIMEOUT_MINUTES',
    15,
    1,
    1440,
  );
  const dbPoolSize = readPositiveInt(config, 'DB_POOL_SIZE', 10, 1, 100);
  const dbPoolQueueLimit = readPositiveInt(
    config,
    'DB_POOL_QUEUE_LIMIT',
    50,
    1,
    1000,
  );
  const dbConnectTimeoutMs = readPositiveInt(
    config,
    'DB_CONNECT_TIMEOUT_MS',
    5000,
    250,
    60_000,
  );
  const dbProbeTimeoutMs = readPositiveInt(
    config,
    'HEALTH_DB_PROBE_TIMEOUT_MS',
    1000,
    100,
    10_000,
  );
  const maxUnpaidBookings = readPositiveInt(
    config,
    'BOOKING_MAX_ACTIVE_UNPAID_PER_CUSTOMER',
    3,
    1,
    20,
  );
  const maxHeldNights = readPositiveInt(
    config,
    'BOOKING_MAX_HELD_NIGHTS_PER_CUSTOMER',
    30,
    1,
    365,
  );
  const maxAdvanceDays = readPositiveInt(
    config,
    'BOOKING_MAX_ADVANCE_DAYS',
    365,
    1,
    3650,
  );
  const schedulersEnabled = readBoolean(
    config,
    'EXPIRATION_SCHEDULERS_ENABLED',
    true,
  );
  const swaggerEnabled = readBoolean(
    config,
    'SWAGGER_ENABLED',
    nodeEnvironment !== 'production',
  );
  const httpJsonBodyLimit = readBodyLimit(
    config,
    'HTTP_JSON_BODY_LIMIT',
    '1mb',
  );
  const httpUrlencodedBodyLimit = readBodyLimit(
    config,
    'HTTP_URLENCODED_BODY_LIMIT',
    '1mb',
  );
  const roomImageDir = readString(
    config,
    'ROOM_IMAGE_UPLOAD_DIR',
    '.data/uploads/room-images',
  );
  const corsOrigins = readCorsOrigins(config);
  const vnpayEnabled = readBoolean(config, 'VNPAY_ENABLED', false);
  const vnpayPaymentUrl = readString(
    config,
    'VNPAY_PAYMENT_URL',
    'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
  );
  const vnpayReturnUrl = readString(
    config,
    'VNPAY_RETURN_URL',
    'http://localhost:3000/api/v1/payments/vnpay/return',
  );
  const frontendReturnUrl = readString(config, 'VNPAY_FRONTEND_RETURN_URL', '');
  const vnpayTmnCode = readString(config, 'VNPAY_TMN_CODE', '');
  const vnpayHashSecret = readString(config, 'VNPAY_HASH_SECRET', '');
  const requestTimeoutMs = readPositiveInt(
    config,
    'VNPAY_REQUEST_TIMEOUT_MS',
    10_000,
    1_000,
    120_000,
  );

  assertHttpUrl(vnpayPaymentUrl, 'VNPAY_PAYMENT_URL', true);
  assertHttpUrl(vnpayReturnUrl, 'VNPAY_RETURN_URL', false);

  if (frontendReturnUrl.length > 0) {
    assertHttpUrl(frontendReturnUrl, 'VNPAY_FRONTEND_RETURN_URL', false);

    if (nodeEnvironment === 'production') {
      assertPublicHttpsUrl(frontendReturnUrl, 'VNPAY_FRONTEND_RETURN_URL');
    }
  }

  if (vnpayEnabled) {
    if (!/^[A-Za-z0-9]{8}$/.test(vnpayTmnCode)) {
      throw new Error(
        'VNPAY_TMN_CODE must contain exactly 8 alphanumeric characters.',
      );
    }

    if (vnpayHashSecret.length < 16) {
      throw new Error('VNPAY_HASH_SECRET must contain at least 16 characters.');
    }

    if (nodeEnvironment === 'production') {
      assertPublicHttpsUrl(vnpayReturnUrl, 'VNPAY_RETURN_URL');
    }
  }

  if (nodeEnvironment === 'production' && corsOrigins.length === 0) {
    throw new Error('CORS_ORIGINS is required in production.');
  }

  return {
    ...config,
    NODE_ENV: nodeEnvironment,
    JWT_ACCESS_TOKEN_SECRET: secret,
    JWT_ACCESS_TOKEN_EXPIRES_IN: expiresIn,
    DB_POOL_SIZE: dbPoolSize,
    DB_POOL_QUEUE_LIMIT: dbPoolQueueLimit,
    DB_CONNECT_TIMEOUT_MS: dbConnectTimeoutMs,
    HEALTH_DB_PROBE_TIMEOUT_MS: dbProbeTimeoutMs,
    BOOKING_PAYMENT_TIMEOUT_MINUTES: paymentTimeoutMinutes,
    BOOKING_MAX_ACTIVE_UNPAID_PER_CUSTOMER: maxUnpaidBookings,
    BOOKING_MAX_HELD_NIGHTS_PER_CUSTOMER: maxHeldNights,
    BOOKING_MAX_ADVANCE_DAYS: maxAdvanceDays,
    EXPIRATION_SCHEDULERS_ENABLED: schedulersEnabled,
    SWAGGER_ENABLED: swaggerEnabled,
    HTTP_JSON_BODY_LIMIT: httpJsonBodyLimit,
    HTTP_URLENCODED_BODY_LIMIT: httpUrlencodedBodyLimit,
    ROOM_IMAGE_UPLOAD_DIR: roomImageDir,
    CORS_ORIGINS: corsOrigins,
    VNPAY_ENABLED: vnpayEnabled,
    VNPAY_PAYMENT_URL: vnpayPaymentUrl,
    VNPAY_RETURN_URL: vnpayReturnUrl,
    VNPAY_FRONTEND_RETURN_URL: frontendReturnUrl,
    VNPAY_TMN_CODE: vnpayTmnCode,
    VNPAY_HASH_SECRET: vnpayHashSecret,
    VNPAY_REQUEST_TIMEOUT_MS: requestTimeoutMs,
  };
}

function readRequiredString(
  config: Record<string, unknown>,
  key: string,
): string {
  const value = config[key];

  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${key} is required.`);
  }

  return value;
}

function readString(
  config: Record<string, unknown>,
  key: string,
  defaultValue: string,
): string {
  const value = config[key];

  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  if (typeof value !== 'string') {
    throw new Error(`${key} must be a string.`);
  }

  return value.trim();
}

function readPositiveInt(
  config: Record<string, unknown>,
  key: string,
  defaultValue: number,
  min: number,
  max: number,
): number {
  const value = config[key];

  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  const parsed = typeof value === 'number' ? value : Number(value);

  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${key} must be an integer from ${min} to ${max}.`);
  }

  return parsed;
}

function readBoolean(
  config: Record<string, unknown>,
  key: string,
  defaultValue: boolean,
): boolean {
  const value = config[key];

  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  if (value === true || value === 'true' || value === '1') {
    return true;
  }

  if (value === false || value === 'false' || value === '0') {
    return false;
  }

  throw new Error(`${key} must be true or false.`);
}

function readBodyLimit(
  config: Record<string, unknown>,
  key: string,
  defaultValue: string,
): string {
  const value = readString(config, key, defaultValue).toLowerCase();

  if (!/^\d+(?:b|kb|mb|gb)$/.test(value)) {
    throw new Error(`${key} must be a size such as 100kb, 1mb, or 1gb.`);
  }

  const match = /^(\d+)(b|kb|mb|gb)$/.exec(value);
  const amount = Number(match?.[1]);
  const unit = match?.[2];
  const multipliers: Record<string, number> = {
    b: 1,
    kb: 1024,
    mb: 1024 ** 2,
    gb: 1024 ** 3,
  };

  if (
    unit === undefined ||
    !Number.isSafeInteger(amount) ||
    amount <= 0 ||
    amount * multipliers[unit] > 50 * 1024 ** 2
  ) {
    throw new Error(`${key} must be greater than zero and no more than 50mb.`);
  }

  return value;
}

function readCorsOrigins(config: Record<string, unknown>): string[] {
  const value = config.CORS_ORIGINS;

  if (value === undefined || value === null || value === '') {
    return [];
  }

  if (typeof value !== 'string') {
    throw new Error('CORS_ORIGINS must be a comma-separated string.');
  }

  const origins = value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0)
    .map((origin) => {
      let url: URL;

      try {
        url = new URL(origin);
      } catch {
        throw new Error(`Invalid CORS origin: ${origin}`);
      }

      if (
        (url.protocol !== 'http:' && url.protocol !== 'https:') ||
        url.pathname !== '/' ||
        url.search.length > 0 ||
        url.hash.length > 0
      ) {
        throw new Error(`Invalid CORS origin: ${origin}`);
      }

      return url.origin;
    });

  return [...new Set(origins)];
}

function assertHttpUrl(
  value: string,
  key: string,
  requireHttps: boolean,
): void {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`${key} must be a valid HTTP URL.`);
  }

  if (
    (requireHttps && url.protocol !== 'https:') ||
    (!requireHttps && url.protocol !== 'http:' && url.protocol !== 'https:')
  ) {
    throw new Error(
      `${key} must use ${requireHttps ? 'HTTPS' : 'HTTP or HTTPS'}.`,
    );
  }
}

function assertPublicHttpsUrl(value: string, key: string): void {
  const url = new URL(value);
  const localHostnames = new Set(['localhost', '127.0.0.1', '::1']);

  if (url.protocol !== 'https:' || localHostnames.has(url.hostname)) {
    throw new Error(`${key} must be a public HTTPS URL in production.`);
  }
}
