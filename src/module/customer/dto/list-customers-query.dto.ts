import { ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

import { AccountStatusEnum } from '../../../common/domain/account.enums';
import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto';

export class ListCustomersQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: '0705840355', type: String })
  @Allow()
  search?: unknown;

  @ApiPropertyOptional({
    enum: AccountStatusEnum,
    example: 'ACTIVE',
    type: String,
  })
  @Allow()
  status?: unknown;
}
