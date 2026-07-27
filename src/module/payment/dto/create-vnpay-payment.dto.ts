import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateVnpayPaymentDto {
  @ApiPropertyOptional({
    enum: ['VNPAYQR', 'VNBANK', 'INTCARD'],
    example: 'VNBANK',
    type: String,
  })
  bankCode?: unknown;

  @ApiPropertyOptional({
    default: 'vn',
    enum: ['vn', 'en'],
    example: 'vn',
    type: String,
  })
  locale?: unknown;
}
