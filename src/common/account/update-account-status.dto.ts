import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';

import { AccountStatusEnum, type AccountStatus } from '../domain/account.enums';

export class UpdateAccountStatusDto {
  @ApiProperty({
    enum: AccountStatusEnum,
    example: 'LOCKED',
    type: String,
  })
  @IsEnum(AccountStatusEnum)
  status: AccountStatus;
}
