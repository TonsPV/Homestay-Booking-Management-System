import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description: 'Email or Vietnamese phone number.',
    example: 'tan@example.com',
    type: String,
  })
  @IsOptional()
  @IsString()
  identifier?: string;

  @ApiHideProperty()
  @IsOptional()
  @IsString()
  emailOrPhone?: string;

  @ApiHideProperty()
  @IsOptional()
  @IsString()
  email?: string;

  @ApiHideProperty()
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiProperty({
    example: 'StrongPassword123!',
    type: String,
    writeOnly: true,
  })
  @IsString()
  password?: string;
}
