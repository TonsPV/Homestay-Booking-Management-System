import { UnauthorizedException } from '@nestjs/common';

import { AccessTokenClaimsValidator } from '../../../../src/module/auth/access-token-claims.validator';

describe('AccessTokenClaimsValidator', () => {
  const NOW = 1_800_000_000;
  let validator: AccessTokenClaimsValidator;

  beforeEach(() => {
    validator = new AccessTokenClaimsValidator();
  });

  describe('validate (structure)', () => {
    it('returns the canonical customer payload for valid claims', () => {
      expect(
        validator.validate({
          sub: 'customer:customer-1',
          actor_type: 'customer',
          customer_id: 'customer-1',
          token_version: 2,
          iat: NOW,
          exp: NOW + 900,
        }),
      ).toEqual({
        sub: 'customer:customer-1',
        actor_type: 'customer',
        customer_id: 'customer-1',
        token_version: 2,
        iat: NOW,
        exp: NOW + 900,
      });
    });

    it('returns the canonical user payload for valid claims', () => {
      expect(
        validator.validate({
          sub: 'user:user-1',
          actor_type: 'user',
          user_id: 'user-1',
          role: 'ADMIN',
          token_version: 4,
          iat: NOW,
          exp: NOW + 900,
        }),
      ).toEqual({
        sub: 'user:user-1',
        actor_type: 'user',
        user_id: 'user-1',
        role: 'ADMIN',
        token_version: 4,
        iat: NOW,
        exp: NOW + 900,
      });
    });

    it.each([
      ['invalid actor_type', { actor_type: 'admin' }],
      ['missing sub', { sub: undefined }],
      ['empty sub', { sub: '' }],
      ['sub mismatch for customer', { sub: 'customer:other' }],
      ['sub mismatch for user', { sub: 'user:other' }],
      ['non-string customer_id', { customer_id: 42 }],
      ['negative token_version', { token_version: -1 }],
      ['float token_version', { token_version: 1.5 }],
      ['non-integer iat', { iat: 1.5 }],
      ['non-integer exp', { exp: 'soon' }],
    ])('rejects %s', (_name, override) => {
      const base = {
        sub: 'customer:customer-1',
        actor_type: 'customer',
        customer_id: 'customer-1',
        token_version: 0,
        iat: NOW,
        exp: NOW + 900,
      };

      expect(() => validator.validate({ ...base, ...override })).toThrow(
        UnauthorizedException,
      );
    });

    it('rejects an invalid role on a user payload', () => {
      expect(() =>
        validator.validate({
          sub: 'user:user-1',
          actor_type: 'user',
          user_id: 'user-1',
          role: 'SUPER_ADMIN',
          token_version: 0,
          iat: NOW,
          exp: NOW + 900,
        }),
      ).toThrow(UnauthorizedException);
    });

    it('ignores a role claim on a customer payload', () => {
      expect(() =>
        validator.validate({
          sub: 'customer:customer-1',
          actor_type: 'customer',
          customer_id: 'customer-1',
          role: 'SUPER_ADMIN',
          token_version: 0,
          iat: NOW,
          exp: NOW + 900,
        }),
      ).not.toThrow();
    });

    it('rejects a missing token_version', () => {
      expect(() =>
        validator.validate({
          sub: 'customer:customer-1',
          actor_type: 'customer',
          customer_id: 'customer-1',
          iat: NOW,
          exp: NOW + 900,
        }),
      ).toThrow(UnauthorizedException);
    });
  });

  describe('enforceTemporaryValidity (time window)', () => {
    const validPayload = {
      sub: 'customer:customer-1',
      actor_type: 'customer' as const,
      customer_id: 'customer-1',
      token_version: 0,
      iat: NOW,
      exp: NOW + 900,
    };

    it('accepts iat up to 60 seconds in the future', () => {
      expect(() =>
        validator.enforceTemporaryValidity(
          { ...validPayload, iat: NOW + 60 },
          NOW,
        ),
      ).not.toThrow();
    });

    it('rejects iat more than 60 seconds in the future', () => {
      expect(() =>
        validator.enforceTemporaryValidity(
          { ...validPayload, iat: NOW + 61 },
          NOW,
        ),
      ).toThrow('Invalid access token.');
    });

    it('rejects exp equal to iat', () => {
      expect(() =>
        validator.enforceTemporaryValidity({ ...validPayload, exp: NOW }, NOW),
      ).toThrow('Invalid access token.');
    });

    it('rejects exp before iat', () => {
      expect(() =>
        validator.enforceTemporaryValidity(
          { ...validPayload, exp: NOW - 10 },
          NOW,
        ),
      ).toThrow('Invalid access token.');
    });

    it('rejects an expired token with the dedicated message', () => {
      expect(() =>
        validator.enforceTemporaryValidity(
          { ...validPayload, iat: NOW - 900, exp: NOW - 1 },
          NOW,
        ),
      ).toThrow('Access token has expired.');
    });

    it('treats exp equal to now as expired', () => {
      expect(() =>
        validator.enforceTemporaryValidity(
          { ...validPayload, iat: NOW - 900, exp: NOW },
          NOW,
        ),
      ).toThrow('Access token has expired.');
    });

    it('accepts a token that is still valid', () => {
      expect(() =>
        validator.enforceTemporaryValidity(validPayload, NOW),
      ).not.toThrow();
    });
  });
});
