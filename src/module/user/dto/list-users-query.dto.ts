import { ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

import {
  AccountStatusEnum,
  UserRoleEnum,
} from '../../../common/domain/account.enums';

export class ListUsersQueryDto {
  @ApiPropertyOptional({ default: 1, example: 1, minimum: 1, type: Number })
  @Allow()
  page?: unknown;

  @ApiPropertyOptional({
    default: 20,
    example: 20,
    maximum: 100,
    minimum: 1,
    type: Number,
  })
  @Allow()
  limit?: unknown;

  @ApiPropertyOptional({ example: 'staff@example.com', type: String })
  @Allow()
  search?: unknown;

  @ApiPropertyOptional({
    enum: UserRoleEnum,
    example: 'STAFF',
    type: String,
  })
  @Allow()
  role?: unknown;

  @ApiPropertyOptional({
    enum: AccountStatusEnum,
    example: 'ACTIVE',
    type: String,
  })
  @Allow()
  status?: unknown;
}
