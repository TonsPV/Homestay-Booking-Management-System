type DurationUnit = 's' | 'm' | 'h' | 'd';

const DURATION_PATTERN = /^(\d+)([smhd])?$/;
const DURATION_MULTIPLIERS: Record<DurationUnit, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
};

export function parseDurationToSeconds(value: string): number {
  const match = DURATION_PATTERN.exec(value.trim());

  if (match === null) {
    throw new Error(
      'Duration must be a positive integer with an optional s, m, h, or d suffix.',
    );
  }

  const amount = Number(match[1]);
  const unit = (match[2] as DurationUnit | undefined) ?? 's';
  const seconds = amount * DURATION_MULTIPLIERS[unit];

  if (
    !Number.isSafeInteger(amount) ||
    !Number.isSafeInteger(seconds) ||
    seconds <= 0
  ) {
    throw new Error('Duration must be a positive finite duration.');
  }

  return seconds;
}

export function isPositiveDuration(value: string): boolean {
  try {
    parseDurationToSeconds(value);
    return true;
  } catch {
    return false;
  }
}
