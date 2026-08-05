import { ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

export class UpdateCustomerProfileDto {
  @ApiPropertyOptional({
    example: 'Pham Van Tan',
    maxLength: 120,
    type: String,
  })
  @Allow()
  fullName?: unknown;

  @ApiPropertyOptional({
    example: 'tan@example.com',
    maxLength: 160,
    nullable: true,
    type: String,
  })
  @Allow()
  email?: unknown;

  @ApiPropertyOptional({ example: '0705840355', type: String })
  @Allow()
  phone?: unknown;
}
