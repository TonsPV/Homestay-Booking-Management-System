import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Allow } from 'class-validator';

export class CreateAmenityDto {
  @ApiProperty({ example: 'Wi-Fi', maxLength: 120, type: String })
  @Allow()
  name?: unknown;

  @ApiPropertyOptional({
    example: 'Internet không dây miễn phí trong phòng.',
    maxLength: 500,
    nullable: true,
    type: String,
  })
  @Allow()
  description?: unknown;
}
