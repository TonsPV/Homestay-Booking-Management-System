import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class RegisterCustomerDto {
  @ApiProperty({ example: 'Pham Van Tan', maxLength: 120, type: String })
  fullName?: unknown;

  @ApiPropertyOptional({
    example: 'tan@example.com',
    maxLength: 160,
    nullable: true,
    type: String,
  })
  email?: unknown;

  @ApiProperty({ example: '0705840355', type: String })
  phone?: unknown;

  @ApiProperty({
    example: 'StrongPassword123!',
    maxLength: 72,
    minLength: 8,
    type: String,
    writeOnly: true,
  })
  password?: unknown;
}
