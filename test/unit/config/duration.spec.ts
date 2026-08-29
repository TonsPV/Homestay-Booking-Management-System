import {
  isPositiveDuration,
  parseDurationToSeconds,
} from '../../../src/config/duration';

describe('duration configuration grammar', () => {
  it.each([
    ['30s', 30],
    ['15m', 15 * 60],
    ['1h', 60 * 60],
    ['7d', 7 * 24 * 60 * 60],
    ['1', 1],
    [' 15m ', 15 * 60],
  ])('parses %s into seconds', (value, expected) => {
    expect(parseDurationToSeconds(value)).toBe(expected);
    expect(isPositiveDuration(value)).toBe(true);
  });

  it.each([
    '0',
    '0s',
    '-1h',
    '1.5h',
    '1w',
    '1ms',
    'forever',
    'Infinity',
    'NaN',
    '1e3',
  ])('rejects unsupported duration %s', (value) => {
    expect(() => parseDurationToSeconds(value)).toThrow();
    expect(isPositiveDuration(value)).toBe(false);
  });

  it('rejects duration values that overflow a safe numeric result', () => {
    expect(() =>
      parseDurationToSeconds(`${Number.MAX_SAFE_INTEGER}d`),
    ).toThrow();
    expect(() => parseDurationToSeconds(`${'9'.repeat(400)}d`)).toThrow();
  });
});
