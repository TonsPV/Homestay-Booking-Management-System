import { ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

export class CreateVnpayPaymentDto {
  @ApiPropertyOptional({
    enum: ['VNPAYQR', 'VNBANK', 'INTCARD'],
    example: 'VNBANK',
    type: String,
  })
  @Allow()
  bankCode?: unknown;

  @ApiPropertyOptional({
    default: 'vn',
    enum: ['vn', 'en'],
    example: 'vn',
    type: String,
  })
  @Allow()
  locale?: unknown;
}
