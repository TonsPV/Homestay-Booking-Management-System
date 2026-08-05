import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

import { UserRoleEnum } from '../../../common/domain/account.enums';

export class CreateUserDto {
  @ApiProperty({ example: 'Nguyen Van Staff', maxLength: 120, type: String })
  @Allow()
  fullName?: unknown;

  @ApiProperty({
    example: 'staff@example.com',
    maxLength: 160,
    type: String,
  })
  @Allow()
  email?: unknown;

  @ApiPropertyOptional({
    example: '0901234567',
    nullable: true,
    type: String,
  })
  @Allow()
  phone?: unknown;

  @ApiProperty({
    example: 'StrongPassword123!',
    maxLength: 72,
    minLength: 8,
    type: String,
    writeOnly: true,
  })
  @Allow()
  password?: unknown;

  @ApiPropertyOptional({
    description: 'Only STAFF accounts can be issued through this endpoint.',
    enum: [UserRoleEnum.STAFF],
    example: 'STAFF',
    type: String,
  })
  @Allow()
  role?: unknown;
}
