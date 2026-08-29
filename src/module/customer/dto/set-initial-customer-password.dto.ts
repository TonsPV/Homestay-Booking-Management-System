import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class SetInitialCustomerPasswordDto {
  @ApiProperty({
    example: 'TemporaryPassword123!',
    minLength: 8,
    maxLength: 72,
    type: String,
    writeOnly: true,
  })
  @IsString()
  password?: string;
}
