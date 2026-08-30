import type { ExecutionContext } from '@nestjs/common';

import { strictBearerExtractor } from '../../../../src/module/auth/strategies/jwt.strategy';

describe('strictBearerExtractor — legacy grammar compatibility', () => {
  function extract(authorization: string | undefined): string | null {
    const request = {
      headers: authorization === undefined ? {} : { authorization },
    };

    return strictBearerExtractor(request);
  }

  it('accepts exactly `Bearer <token>`', () => {
    expect(extract('Bearer valid-token')).toBe('valid-token');
  });

  it.each([
    'Basic xxx',
    'bearer xxx',
    'BEARER xxx',
    'Bearer',
    'Bearer ',
    'Bearer  token',
    ' Bearer token',
    'Bearer token ',
    'Bearer token extra',
    'Bearer token trailing-data',
  ])('rejects header %p (returns null)', (authorization) => {
    expect(extract(authorization)).toBeNull();
  });

  it('rejects a missing Authorization header', () => {
    expect(extract(undefined)).toBeNull();
  });

  it('rejects a non-string Authorization header', () => {
    expect(
      strictBearerExtractor({
        headers: { authorization: 12345 },
      }),
    ).toBeNull();
  });

  it('rejects a request without headers', () => {
    expect(strictBearerExtractor({})).toBeNull();
    expect(strictBearerExtractor(null)).toBeNull();
  });

  it('is compatible with the ExecutionContext request shape used by guards', () => {
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          headers: { authorization: 'Bearer abc.def.ghi' },
        }),
      }),
    } as unknown as ExecutionContext;
    const request = (
      context.switchToHttp as () => { getRequest: () => unknown }
    )().getRequest();

    expect(strictBearerExtractor(request)).toBe('abc.def.ghi');
  });
});
