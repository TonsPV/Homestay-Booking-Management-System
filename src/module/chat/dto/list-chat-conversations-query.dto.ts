import { ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

import { PaginationQueryDto } from '../../../common/pagination/pagination-query.dto';

export class ListChatConversationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    example: 'BK-20260913',
    maxLength: 160,
    type: String,
    description: 'Search by booking code.',
  })
  @Allow()
  search?: unknown;

  @ApiPropertyOptional({ example: true, type: Boolean })
  @Allow()
  unread?: unknown;

  @ApiPropertyOptional({
    example: true,
    type: Boolean,
    description: 'Only available to STAFF and ADMIN.',
  })
  @Allow()
  needsReply?: unknown;
}
