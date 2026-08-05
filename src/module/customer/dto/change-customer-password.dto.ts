import { ApiProperty } from '@nestjs/swagger';
import { Allow } from 'class-validator';

export class ChangeCustomerPasswordDto {
  @ApiProperty({
    example: 'CurrentPassword123!',
    minLength: 1,
    type: String,
    writeOnly: true,
  })
  @Allow()
  currentPassword?: unknown;

  @ApiProperty({
    example: 'NewPassword456!',
    minLength: 8,
    maxLength: 72,
    type: String,
    writeOnly: true,
  })
  @Allow()
  newPassword?: unknown;
}
