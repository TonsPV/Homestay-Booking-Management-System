import { ApiProperty } from '@nestjs/swagger';

import { AuthCustomerDto } from '../../auth/dto/auth-response.dto';
import { CustomerCredentialCapabilitiesDto } from './customer-credential-capabilities.dto';

export class AdminCustomerDto extends AuthCustomerDto {
  @ApiProperty({ type: CustomerCredentialCapabilitiesDto })
  credentialCapabilities!: CustomerCredentialCapabilitiesDto;
}
