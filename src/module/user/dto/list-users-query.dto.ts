import { ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

import {
  AccountStatusEnum,
  UserRoleEnum,
} from '../../../common/domain/account.enums';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto';

export class ListUsersQueryDto extends PaginationQueryDto {
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
