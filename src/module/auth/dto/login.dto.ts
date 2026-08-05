import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { Allow } from 'class-validator';

export class LoginDto {
  @ApiProperty({
    description: 'Email or Vietnamese phone number.',
    example: 'tan@example.com',
    type: String,
  })
  @Allow()
  identifier?: unknown;

  @ApiHideProperty()
  @Allow()
  emailOrPhone?: unknown;

  @ApiHideProperty()
  @Allow()
  email?: unknown;

  @ApiHideProperty()
  @Allow()
  phone?: unknown;

  @ApiProperty({
    example: 'StrongPassword123!',
    type: String,
    writeOnly: true,
  })
  @Allow()
  password?: unknown;
}
