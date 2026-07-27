import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';

export class LoginDto {
  @ApiProperty({
    description: 'Email or Vietnamese phone number.',
    example: 'tan@example.com',
    type: String,
  })
  identifier?: unknown;

  @ApiHideProperty()
  emailOrPhone?: unknown;

  @ApiHideProperty()
  email?: unknown;

  @ApiHideProperty()
  phone?: unknown;

  @ApiProperty({
    example: 'StrongPassword123!',
    type: String,
    writeOnly: true,
  })
  password?: unknown;
}
