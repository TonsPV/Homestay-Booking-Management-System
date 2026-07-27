import { ApiProperty } from '@nestjs/swagger';

export class SetInitialCustomerPasswordDto {
  @ApiProperty({
    example: 'TemporaryPassword123!',
    minLength: 8,
    maxLength: 72,
    type: String,
    writeOnly: true,
  })
  password?: unknown;
}
