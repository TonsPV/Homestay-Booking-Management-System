import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateCustomerProfileDto {
  @ApiPropertyOptional({
    example: 'Pham Van Tan',
    maxLength: 120,
    type: String,
  })
  fullName?: unknown;

  @ApiPropertyOptional({
    example: 'tan@example.com',
    maxLength: 160,
    nullable: true,
    type: String,
  })
  email?: unknown;

  @ApiPropertyOptional({ example: '0705840355', type: String })
  phone?: unknown;
}
