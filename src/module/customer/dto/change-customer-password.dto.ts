import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class ChangeCustomerPasswordDto {
  @ApiProperty({
    example: 'CurrentPassword123!',
    minLength: 1,
    type: String,
    writeOnly: true,
  })
  @IsString()
  currentPassword?: string;

  @ApiProperty({
    example: 'NewPassword456!',
    minLength: 8,
    maxLength: 72,
    type: String,
    writeOnly: true,
  })
  @IsString()
  newPassword?: string;
}
