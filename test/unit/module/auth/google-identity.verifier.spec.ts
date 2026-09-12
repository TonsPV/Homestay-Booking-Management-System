import { AppHttpException } from '../../../../src/common/http/app-http-exception';
import { GoogleIdentityVerifier } from '../../../../src/module/auth/google-identity.verifier';

describe('GoogleIdentityVerifier', () => {
  it('is disabled unless the feature flag and client id are configured', async () => {
    const verifier = new GoogleIdentityVerifier({
      get: jest.fn((key: string) =>
        key === 'GOOGLE_AUTH_ENABLED' ? false : undefined,
      ),
    } as never);

    expect(verifier.isEnabled()).toBe(false);
    await expect(verifier.verify('token')).rejects.toMatchObject({
      status: 503,
    });
  });

  it('rejects a credential when Google cannot verify it', async () => {
    const verifier = new GoogleIdentityVerifier({
      get: jest.fn((key: string) => {
        if (key === 'GOOGLE_AUTH_ENABLED') return true;
        if (key === 'GOOGLE_CLIENT_ID') return 'client-id';
        return undefined;
      }),
    } as never);

    (
      verifier as unknown as {
        client: { verifyIdToken: jest.Mock };
      }
    ).client.verifyIdToken = jest
      .fn()
      .mockRejectedValue(new Error('invalid token'));

    await expect(verifier.verify('not-a-token')).rejects.toBeInstanceOf(
      AppHttpException,
    );
  });

  it('returns only normalized, verified identity fields', async () => {
    const verifier = new GoogleIdentityVerifier({
      get: jest.fn((key: string) => {
        if (key === 'GOOGLE_AUTH_ENABLED') return true;
        if (key === 'GOOGLE_CLIENT_ID') return 'client-id';
        return undefined;
      }),
    } as never);

    (
      verifier as unknown as {
        client: { verifyIdToken: jest.Mock };
      }
    ).client.verifyIdToken = jest.fn().mockResolvedValue({
      getPayload: () => ({
        email: '  Guest@Example.COM ',
        email_verified: true,
        name: '  Guest  ',
        sub: 'google-subject-1',
      }),
    });

    await expect(verifier.verify('valid-token')).resolves.toEqual({
      email: 'guest@example.com',
      emailVerified: true,
      fullName: 'Guest',
      subject: 'google-subject-1',
    });
  });
});
