const MIN_JWT_SECRET_LENGTH = 32;
const DISALLOWED_JWT_SECRETS = new Set([
  'change-this-development-access-token-secret',
  'replace_with_a_long_random_secret',
]);

export function validateEnvironment(
  config: Record<string, unknown>,
): Record<string, unknown> {
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

  return {
    ...config,
    JWT_ACCESS_TOKEN_SECRET: secret,
    JWT_ACCESS_TOKEN_EXPIRES_IN: expiresIn,
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

function isPositiveDuration(value: string): boolean {
  const match = /^(\d+)([smhd])?$/.exec(value);

  return match !== null && Number(match[1]) > 0;
}
