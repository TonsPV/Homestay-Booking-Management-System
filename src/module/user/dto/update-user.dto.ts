import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateUserDto {
  @ApiPropertyOptional({
    example: 'Nguyen Van Staff',
    maxLength: 120,
    type: String,
  })
  fullName?: unknown;

  @ApiPropertyOptional({
    example: 'staff@example.com',
    maxLength: 160,
    type: String,
  })
  email?: unknown;

  @ApiPropertyOptional({
    example: '0901234567',
    nullable: true,
    type: String,
  })
  phone?: unknown;

  @ApiPropertyOptional({
    example: 'UpdatedPassword456!',
    maxLength: 72,
    minLength: 8,
    type: String,
    writeOnly: true,
  })
  password?: unknown;

  @ApiPropertyOptional({
    enum: ['STAFF'],
    example: 'STAFF',
    type: String,
  })
  role?: unknown;
}
