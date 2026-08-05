import { ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

import { UserRoleEnum } from '../../../common/domain/account.enums';

export class UpdateUserDto {
  @ApiPropertyOptional({
    example: 'Nguyen Van Staff',
    maxLength: 120,
    type: String,
  })
  @Allow()
  fullName?: unknown;

  @ApiPropertyOptional({
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

  @ApiPropertyOptional({
    example: 'UpdatedPassword456!',
    maxLength: 72,
    minLength: 8,
    type: String,
    writeOnly: true,
  })
  @Allow()
  password?: unknown;

  @ApiPropertyOptional({
    enum: [UserRoleEnum.STAFF],
    example: 'STAFF',
    type: String,
  })
  @Allow()
  role?: unknown;
}
