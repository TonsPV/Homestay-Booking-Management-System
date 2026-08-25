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
  const nodeEnvironment = readOptionalString(
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

  const expiresIn = readOptionalString(
    config,
    'JWT_ACCESS_TOKEN_EXPIRES_IN',
    '1h',
  );

  if (!isPositiveDuration(expiresIn)) {
    throw new Error(
      'JWT_ACCESS_TOKEN_EXPIRES_IN must be a positive duration such as 15m, 1h, or 7d.',
    );
  }

  const bookingPaymentTimeoutMinutes = readOptionalPositiveInteger(
    config,
    'BOOKING_PAYMENT_TIMEOUT_MINUTES',
    15,
    1,
    1440,
  );
  const databasePoolSize = readOptionalPositiveInteger(
    config,
    'DB_POOL_SIZE',
    10,
    1,
    100,
  );
  const databasePoolQueueLimit = readOptionalPositiveInteger(
    config,
    'DB_POOL_QUEUE_LIMIT',
    50,
    1,
    1000,
  );
  const databaseConnectTimeoutMs = readOptionalPositiveInteger(
    config,
    'DB_CONNECT_TIMEOUT_MS',
    5000,
    250,
    60_000,
  );
  const bookingMaxActiveUnpaidPerCustomer = readOptionalPositiveInteger(
    config,
    'BOOKING_MAX_ACTIVE_UNPAID_PER_CUSTOMER',
    3,
    1,
    20,
  );
  const bookingMaxHeldNightsPerCustomer = readOptionalPositiveInteger(
    config,
    'BOOKING_MAX_HELD_NIGHTS_PER_CUSTOMER',
    30,
    1,
    365,
  );
  const bookingMaxAdvanceDays = readOptionalPositiveInteger(
    config,
    'BOOKING_MAX_ADVANCE_DAYS',
    365,
    1,
    3650,
  );
  const expirationSchedulersEnabled = readOptionalBoolean(
    config,
    'EXPIRATION_SCHEDULERS_ENABLED',
    true,
  );
  const swaggerEnabled = readOptionalBoolean(
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
  const customerClaimSmsEnabled = readOptionalBoolean(
    config,
    'CUSTOMER_CLAIM_SMS_ENABLED',
    false,
  );
  const customerClaimLocalBypassEnabled = readOptionalBoolean(
    config,
    'CUSTOMER_CLAIM_LOCAL_BYPASS_ENABLED',
    false,
  );
  const customerClaimSmsProvider = readOptionalString(
    config,
    'CUSTOMER_CLAIM_SMS_PROVIDER',
    'disabled',
  ).toLowerCase();
  const customerClaimOtpLifetimeMinutes = readOptionalPositiveInteger(
    config,
    'CUSTOMER_CLAIM_OTP_LIFETIME_MINUTES',
    5,
    1,
    15,
  );
  const customerClaimOtpMaxAttempts = readOptionalPositiveInteger(
    config,
    'CUSTOMER_CLAIM_OTP_MAX_ATTEMPTS',
    5,
    1,
    10,
  );
  const customerClaimOtpResendCooldownSeconds = readOptionalPositiveInteger(
    config,
    'CUSTOMER_CLAIM_OTP_RESEND_COOLDOWN_SECONDS',
    60,
    30,
    600,
  );
  const customerClaimOtpRateWindowMinutes = readOptionalPositiveInteger(
    config,
    'CUSTOMER_CLAIM_OTP_RATE_WINDOW_MINUTES',
    15,
    1,
    60,
  );
  const customerClaimOtpPhoneWindowLimit = readOptionalPositiveInteger(
    config,
    'CUSTOMER_CLAIM_OTP_PHONE_WINDOW_LIMIT',
    3,
    1,
    20,
  );
  const customerClaimOtpPhoneDailyLimit = readOptionalPositiveInteger(
    config,
    'CUSTOMER_CLAIM_OTP_PHONE_DAILY_LIMIT',
    10,
    1,
    100,
  );
  const customerClaimOtpIpWindowLimit = readOptionalPositiveInteger(
    config,
    'CUSTOMER_CLAIM_OTP_IP_WINDOW_LIMIT',
    20,
    1,
    200,
  );
  const customerClaimTokenLifetimeMinutes = readOptionalPositiveInteger(
    config,
    'CUSTOMER_CLAIM_TOKEN_LIFETIME_MINUTES',
    10,
    1,
    30,
  );
  const roomImageUploadDirectory = readOptionalString(
    config,
    'ROOM_IMAGE_UPLOAD_DIR',
    '.data/uploads/room-images',
  );
  const corsOrigins = readCorsOrigins(config);
  const vnpayEnabled = readOptionalBoolean(config, 'VNPAY_ENABLED', false);
  const vnpayPaymentUrl = readOptionalString(
    config,
    'VNPAY_PAYMENT_URL',
    'https://sandbox.vnpayment.vn/paymentv2/vpcpay.html',
  );
  const vnpayReturnUrl = readOptionalString(
    config,
    'VNPAY_RETURN_URL',
    'http://localhost:3000/api/v1/payments/vnpay/return',
  );
  const vnpayFrontendReturnUrl = readOptionalString(
    config,
    'VNPAY_FRONTEND_RETURN_URL',
    '',
  );
  const vnpayTmnCode = readOptionalString(config, 'VNPAY_TMN_CODE', '');
  const vnpayHashSecret = readOptionalString(config, 'VNPAY_HASH_SECRET', '');
  const vnpayRequestTimeoutMs = readOptionalPositiveInteger(
    config,
    'VNPAY_REQUEST_TIMEOUT_MS',
    10_000,
    1_000,
    120_000,
  );

  assertHttpUrl(vnpayPaymentUrl, 'VNPAY_PAYMENT_URL', true);
  assertHttpUrl(vnpayReturnUrl, 'VNPAY_RETURN_URL', false);

  if (vnpayFrontendReturnUrl.length > 0) {
    assertHttpUrl(vnpayFrontendReturnUrl, 'VNPAY_FRONTEND_RETURN_URL', false);

    if (nodeEnvironment === 'production') {
      assertPublicHttpsUrl(vnpayFrontendReturnUrl, 'VNPAY_FRONTEND_RETURN_URL');
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

  if (!['disabled', 'test'].includes(customerClaimSmsProvider)) {
    throw new Error(
      'CUSTOMER_CLAIM_SMS_PROVIDER must be disabled or test until a production provider adapter is installed.',
    );
  }

  if (customerClaimSmsProvider === 'test' && nodeEnvironment !== 'test') {
    throw new Error(
      'CUSTOMER_CLAIM_SMS_PROVIDER=test is allowed only when NODE_ENV=test.',
    );
  }

  if (
    customerClaimLocalBypassEnabled &&
    (typeof config.NODE_ENV !== 'string' ||
      (nodeEnvironment !== 'development' && nodeEnvironment !== 'test'))
  ) {
    throw new Error(
      'CUSTOMER_CLAIM_LOCAL_BYPASS_ENABLED requires explicit NODE_ENV=development or test.',
    );
  }

  if (customerClaimSmsEnabled && customerClaimSmsProvider === 'disabled') {
    throw new Error(
      'CUSTOMER_CLAIM_SMS_ENABLED requires an installed SMS provider.',
    );
  }

  if (!customerClaimSmsEnabled && customerClaimSmsProvider !== 'disabled') {
    throw new Error(
      'CUSTOMER_CLAIM_SMS_PROVIDER must be disabled when CUSTOMER_CLAIM_SMS_ENABLED is false.',
    );
  }

  return {
    ...config,
    NODE_ENV: nodeEnvironment,
    JWT_ACCESS_TOKEN_SECRET: secret,
    JWT_ACCESS_TOKEN_EXPIRES_IN: expiresIn,
    DB_POOL_SIZE: databasePoolSize,
    DB_POOL_QUEUE_LIMIT: databasePoolQueueLimit,
    DB_CONNECT_TIMEOUT_MS: databaseConnectTimeoutMs,
    BOOKING_PAYMENT_TIMEOUT_MINUTES: bookingPaymentTimeoutMinutes,
    BOOKING_MAX_ACTIVE_UNPAID_PER_CUSTOMER: bookingMaxActiveUnpaidPerCustomer,
    BOOKING_MAX_HELD_NIGHTS_PER_CUSTOMER: bookingMaxHeldNightsPerCustomer,
    BOOKING_MAX_ADVANCE_DAYS: bookingMaxAdvanceDays,
    EXPIRATION_SCHEDULERS_ENABLED: expirationSchedulersEnabled,
    SWAGGER_ENABLED: swaggerEnabled,
    HTTP_JSON_BODY_LIMIT: httpJsonBodyLimit,
    HTTP_URLENCODED_BODY_LIMIT: httpUrlencodedBodyLimit,
    CUSTOMER_CLAIM_SMS_ENABLED: customerClaimSmsEnabled,
    CUSTOMER_CLAIM_LOCAL_BYPASS_ENABLED: customerClaimLocalBypassEnabled,
    CUSTOMER_CLAIM_SMS_PROVIDER: customerClaimSmsProvider,
    CUSTOMER_CLAIM_OTP_LIFETIME_MINUTES: customerClaimOtpLifetimeMinutes,
    CUSTOMER_CLAIM_OTP_MAX_ATTEMPTS: customerClaimOtpMaxAttempts,
    CUSTOMER_CLAIM_OTP_RESEND_COOLDOWN_SECONDS:
      customerClaimOtpResendCooldownSeconds,
    CUSTOMER_CLAIM_OTP_RATE_WINDOW_MINUTES: customerClaimOtpRateWindowMinutes,
    CUSTOMER_CLAIM_OTP_PHONE_WINDOW_LIMIT: customerClaimOtpPhoneWindowLimit,
    CUSTOMER_CLAIM_OTP_PHONE_DAILY_LIMIT: customerClaimOtpPhoneDailyLimit,
    CUSTOMER_CLAIM_OTP_IP_WINDOW_LIMIT: customerClaimOtpIpWindowLimit,
    CUSTOMER_CLAIM_TOKEN_LIFETIME_MINUTES: customerClaimTokenLifetimeMinutes,
    ROOM_IMAGE_UPLOAD_DIR: roomImageUploadDirectory,
    CORS_ORIGINS: corsOrigins,
    VNPAY_ENABLED: vnpayEnabled,
    VNPAY_PAYMENT_URL: vnpayPaymentUrl,
    VNPAY_RETURN_URL: vnpayReturnUrl,
    VNPAY_FRONTEND_RETURN_URL: vnpayFrontendReturnUrl,
    VNPAY_TMN_CODE: vnpayTmnCode,
    VNPAY_HASH_SECRET: vnpayHashSecret,
    VNPAY_REQUEST_TIMEOUT_MS: vnpayRequestTimeoutMs,
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

function readOptionalString(
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

function readOptionalPositiveInteger(
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

function readOptionalBoolean(
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
  const value = readOptionalString(config, key, defaultValue).toLowerCase();

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
