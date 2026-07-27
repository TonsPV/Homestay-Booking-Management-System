import { ApiProperty } from '@nestjs/swagger';

export class ChangeCustomerPasswordDto {
  @ApiProperty({
    example: 'CurrentPassword123!',
    minLength: 1,
    type: String,
    writeOnly: true,
  })
  currentPassword?: unknown;

  @ApiProperty({
    example: 'NewPassword456!',
    minLength: 8,
    maxLength: 72,
    type: String,
    writeOnly: true,
  })
  newPassword?: unknown;
}
