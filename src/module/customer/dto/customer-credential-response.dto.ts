import { ApiProperty } from '@nestjs/swagger';

export class CustomerCredentialResultDto {
  @ApiProperty({ example: true })
  passwordConfigured: boolean;
}
