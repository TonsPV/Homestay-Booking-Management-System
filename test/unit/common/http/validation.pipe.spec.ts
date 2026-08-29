import { ValidationPipe } from '@nestjs/common';

import { RegisterCustomerDto } from '../../../../src/module/auth/dto/register-customer.dto';
import { CreateBookingDto } from '../../../../src/module/booking/dto/create-booking.dto';
import { CreateManualPaymentDto } from '../../../../src/module/payment/dto/create-manual-payment.dto';
import { PaymentMethod } from '../../../../src/module/payment/domain/payment-state';
import { CreateRoomTypeDto } from '../../../../src/module/room-type/dto/create-room-type.dto';
import { RoomTypeBedInputDto } from '../../../../src/module/room-type/dto/room-type-bed.dto';
import { BedType } from '../../../../src/module/room-type/bed-configuration';

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

  it('validates payment enum values at the DTO boundary', async () => {
    const value = (await pipe.transform(
      { method: PaymentMethod.CASH },
      { type: 'body', metatype: CreateManualPaymentDto },
    )) as CreateManualPaymentDto;

    expect(value).toBeInstanceOf(CreateManualPaymentDto);
    expect(value.method).toBe(PaymentMethod.CASH);

    await expect(
      pipe.transform(
        { method: PaymentMethod.VNPAY },
        { type: 'body', metatype: CreateManualPaymentDto },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('rejects wrong primitive types without implicit conversion', async () => {
    await expect(
      pipe.transform(
        {
          roomId: '999999',
          checkInDate: '2030-08-01',
          checkOutDate: '2030-08-03',
          guestCount: '2',
        },
        { type: 'body', metatype: CreateBookingDto },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('allows a structurally valid booking id through for service business checks', async () => {
    const value = (await pipe.transform(
      {
        roomId: '999999',
        checkInDate: '2030-08-01',
        checkOutDate: '2030-08-03',
        guestCount: 2,
      },
      { type: 'body', metatype: CreateBookingDto },
    )) as CreateBookingDto;

    expect(value.roomId).toBe('999999');
  });

  it('validates nested room type beds while preserving numeric base prices', async () => {
    const value = (await pipe.transform(
      {
        name: 'Double room',
        maxGuests: 2,
        basePrice: 900000,
        beds: [{ type: BedType.DOUBLE, quantity: 1 }],
      },
      { type: 'body', metatype: CreateRoomTypeDto },
    )) as CreateRoomTypeDto;

    expect(value.beds?.[0]).toBeInstanceOf(RoomTypeBedInputDto);
    expect(value.basePrice).toBe(900000);

    await expect(
      pipe.transform(
        {
          name: 'Double room',
          maxGuests: 2,
          basePrice: '900000.00',
          beds: [{ type: BedType.DOUBLE, quantity: '1' }],
        },
        { type: 'body', metatype: CreateRoomTypeDto },
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
