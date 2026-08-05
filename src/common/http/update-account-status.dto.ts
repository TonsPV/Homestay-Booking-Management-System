import { ApiProperty } from '@nestjs/swagger';
import { Allow } from 'class-validator';

import { AccountStatusEnum } from '../domain/account.enums';

export class UpdateAccountStatusDto {
  @ApiProperty({
    enum: AccountStatusEnum,
    example: 'LOCKED',
    type: String,
  })
  @Allow()
  status?: unknown;
}
