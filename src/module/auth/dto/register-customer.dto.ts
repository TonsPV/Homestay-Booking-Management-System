import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

export class RegisterCustomerDto {
  @ApiProperty({ example: 'Pham Van Tan', maxLength: 120, type: String })
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

  @ApiProperty({ example: '0705840355', type: String })
  @Allow()
  phone?: unknown;

  @ApiProperty({
    example: 'StrongPassword123!',
    maxLength: 72,
    minLength: 8,
    type: String,
    writeOnly: true,
  })
  @Allow()
  password?: unknown;
}
