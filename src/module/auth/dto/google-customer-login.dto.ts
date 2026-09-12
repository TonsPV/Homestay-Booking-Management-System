import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

export class GoogleCustomerLoginDto {
  @ApiProperty({
    description: 'Google Identity Services ID token returned by the browser.',
    type: String,
    writeOnly: true,
  })
  @IsString()
  @MaxLength(4096)
  credential?: string;

  @ApiPropertyOptional({
    description:
      'Vietnamese phone number required when this Google identity is new.',
    example: '0901234567',
    type: String,
  })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  phone?: string;
}
