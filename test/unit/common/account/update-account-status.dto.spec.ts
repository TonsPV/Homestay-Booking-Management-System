import { ValidationPipe } from '@nestjs/common';

import {
  AccountStatusEnum,
  type AccountStatus,
} from '../../../../src/common/domain/account.enums';
import { UpdateAccountStatusDto } from '../../../../src/common/account/update-account-status.dto';

describe('UpdateAccountStatusDto', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: {
      enableImplicitConversion: false,
    },
  });
  const metadata = {
    type: 'body' as const,
    metatype: UpdateAccountStatusDto,
  };

  it('rejects a missing status', async () => {
    await expect(pipe.transform({}, metadata)).rejects.toMatchObject({
      status: 400,
    });
  });

  it('rejects a status outside the shared account enum', async () => {
    await expect(
      pipe.transform({ status: 'DISABLED' }, metadata),
    ).rejects.toMatchObject({ status: 400 });
  });

  it.each([AccountStatusEnum.ACTIVE, AccountStatusEnum.LOCKED])(
    'accepts %s',
    async (status: AccountStatus) => {
      const value = (await pipe.transform({ status }, metadata)) as unknown;

      expect(value).toBeInstanceOf(UpdateAccountStatusDto);
      expect(value).toMatchObject({ status });
    },
  );
});
