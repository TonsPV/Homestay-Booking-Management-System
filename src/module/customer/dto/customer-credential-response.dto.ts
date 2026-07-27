import { ApiProperty } from '@nestjs/swagger';

export class CustomerCredentialResultDto {
  @ApiProperty({ example: true })
  passwordConfigured: boolean;
}

export class CustomerCredentialEnvelopeDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 200 })
  statusCode: number;

  @ApiProperty({ example: 'Cap nhat mat khau customer thanh cong.' })
  message: string;

  @ApiProperty({ type: CustomerCredentialResultDto })
  data: CustomerCredentialResultDto;

  @ApiProperty({ example: '/api/v1/customers/me/password' })
  path: string;

  @ApiProperty({ example: '2026-07-27T05:00:00.000Z', format: 'date-time' })
  timestamp: string;
}
