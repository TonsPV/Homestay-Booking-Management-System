import { ApiProperty } from '@nestjs/swagger';

export class UpdateAccountStatusDto {
  @ApiProperty({
    enum: ['ACTIVE', 'LOCKED'],
    example: 'LOCKED',
    type: String,
  })
  status?: unknown;
}
