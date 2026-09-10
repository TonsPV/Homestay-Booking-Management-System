import { ApiProperty } from '@nestjs/swagger';

import {
  CREDENTIAL_REASON_CODES,
  type CredentialReasonCode,
} from '../customer.types';

export class CustomerCredentialCapabilitiesDto {
  @ApiProperty({ example: true })
  canSetInitialPassword!: boolean;

  @ApiProperty({
    example: null,
    nullable: true,
    enum: [...CREDENTIAL_REASON_CODES, null],
  })
  reasonCode!: CredentialReasonCode;
}
