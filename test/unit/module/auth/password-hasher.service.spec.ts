import { PasswordHasherService } from '../../../../src/module/auth/password-hasher.service';

describe('PasswordHasherService', () => {
  let service: PasswordHasherService;

  beforeEach(() => {
    service = new PasswordHasherService();
  });

  it('round-trips a password and rejects a different password', async () => {
    const hash = await service.hash('StrongPassword123!');

    await expect(service.verify('StrongPassword123!', hash)).resolves.toBe(
      true,
    );
    await expect(service.verify('WrongPassword123!', hash)).resolves.toBe(
      false,
    );
  });

  it.each([
    null,
    '',
    'bcrypt$broken',
    'scrypt$16384$8$1$bad',
    'scrypt$32768$8$1$MTIzNDU2Nzg5MDEyMzQ1Ng$YWJj',
    'scrypt$16384$8$1$YWJj$YWJj',
  ])('returns false for a malformed or unsupported hash', async (hash) => {
    await expect(service.verify('StrongPassword123!', hash)).resolves.toBe(
      false,
    );
  });

  it('performs dummy scrypt verification when a login hash is missing', async () => {
    const verify = jest.spyOn(service, 'verify');

    await expect(
      service.verifyOrDummy('StrongPassword123!', null),
    ).resolves.toBe(false);
    expect(verify).toHaveBeenCalledWith(
      'StrongPassword123!',
      expect.stringMatching(/^scrypt\$16384\$8\$1\$/),
    );
  });

  it('uses a valid stored login hash and preserves the verification result', async () => {
    const hash = await service.hash('StrongPassword123!');
    const verify = jest.spyOn(service, 'verify');

    await expect(
      service.verifyOrDummy('StrongPassword123!', hash),
    ).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith('StrongPassword123!', hash);
  });

  it('replaces a malformed login hash with the dummy hash', async () => {
    const verify = jest.spyOn(service, 'verify');

    await expect(
      service.verifyOrDummy('StrongPassword123!', 'bcrypt$broken'),
    ).resolves.toBe(false);
    expect(verify).toHaveBeenCalledWith(
      'StrongPassword123!',
      expect.stringMatching(/^scrypt\$16384\$8\$1\$/),
    );
  });
});
