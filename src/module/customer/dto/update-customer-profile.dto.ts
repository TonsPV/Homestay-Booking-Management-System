import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpdateCustomerProfileDto {
  @ApiPropertyOptional({
    example: 'Pham Van Tan',
    maxLength: 120,
    type: String,
  })
  @IsOptional()
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

  @ApiPropertyOptional({ example: '0705840355', type: String })
  @IsOptional()
  @IsString()
  phone?: string | null;
}
