import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class RegisterCustomerDto {
  @ApiProperty({ example: 'Pham Van Tan', maxLength: 120, type: String })
  @IsString()
  fullName?: string;

  @ApiPropertyOptional({
    example: 'tan@example.com',
    maxLength: 160,
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsString()
  email?: string | null;

  @ApiProperty({ example: '0705840355', type: String })
  @IsString()
  phone?: string;

  @ApiProperty({
    example: 'StrongPassword123!',
    maxLength: 72,
    minLength: 8,
    type: String,
    writeOnly: true,
  })
  @IsString()
  password?: string;
}
