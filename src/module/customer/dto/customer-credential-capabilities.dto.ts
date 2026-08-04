import { ApiProperty } from '@nestjs/swagger';

import {
  CUSTOMER_CREDENTIAL_CAPABILITY_REASON_CODES,
  type CustomerCredentialCapabilityReasonCode,
} from '../customer-credential.policy';

export class CustomerCredentialCapabilitiesDto {
  @ApiProperty({ example: true })
  canSetInitialPassword!: boolean;

  @ApiProperty({
    example: null,
    nullable: true,
    enum: [...CUSTOMER_CREDENTIAL_CAPABILITY_REASON_CODES, null],
  })
  reasonCode!: CustomerCredentialCapabilityReasonCode;
}
