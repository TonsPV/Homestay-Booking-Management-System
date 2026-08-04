import { ApiProperty } from '@nestjs/swagger';

import { AccountStatusEnum } from '../domain/account.enums';

export class UpdateAccountStatusDto {
  @ApiProperty({
    enum: AccountStatusEnum,
    example: 'LOCKED',
    type: String,
  })
  status?: unknown;
}
