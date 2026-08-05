import { ApiProperty } from '@nestjs/swagger';
import { Allow } from 'class-validator';

export class SetInitialCustomerPasswordDto {
  @ApiProperty({
    example: 'TemporaryPassword123!',
    minLength: 8,
    maxLength: 72,
    type: String,
    writeOnly: true,
  })
  @Allow()
  password?: unknown;
}
