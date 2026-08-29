import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';

export class CreateVnpayPaymentDto {
  @ApiPropertyOptional({
    enum: ['VNPAYQR', 'VNBANK', 'INTCARD'],
    example: 'VNBANK',
    type: String,
  })
  @IsOptional()
  @IsIn(['', 'VNPAYQR', 'VNBANK', 'INTCARD'])
  bankCode?: string | null;

  @ApiPropertyOptional({
    default: 'vn',
    enum: ['vn', 'en'],
    example: 'vn',
    type: String,
  })
  @IsOptional()
  @IsIn(['', 'vn', 'en'])
  locale?: string | null;
}
