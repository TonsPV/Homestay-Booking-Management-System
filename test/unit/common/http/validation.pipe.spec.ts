import { ValidationPipe } from '@nestjs/common';

import { RegisterCustomerDto } from '../../../../src/module/auth/dto/register-customer.dto';

describe('global request validation policy', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: {
      enableImplicitConversion: false,
    },
  });

  it('rejects fields that are not declared by the request DTO', async () => {
    await expect(
      pipe.transform(
        {
          fullName: 'Pham Van Tan',
          phone: '0901234567',
          password: 'StrongPassword123!',
          unexpectedField: true,
        },
        { type: 'body', metatype: RegisterCustomerDto },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('keeps a valid DTO as a class instance without implicit type coercion', async () => {
    const value = (await pipe.transform(
      {
        fullName: 'Pham Van Tan',
        phone: '0901234567',
        password: 'StrongPassword123!',
      },
      { type: 'body', metatype: RegisterCustomerDto },
    )) as unknown;

    expect(value).toBeInstanceOf(RegisterCustomerDto);
    expect(value).toMatchObject({
      fullName: 'Pham Van Tan',
      phone: '0901234567',
    });
  });
});
