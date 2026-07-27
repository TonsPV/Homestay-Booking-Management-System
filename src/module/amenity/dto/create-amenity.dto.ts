import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateAmenityDto {
  @ApiProperty({ example: 'Wi-Fi', maxLength: 120, type: String })
  name?: unknown;

  @ApiPropertyOptional({
    example: 'Internet không dây miễn phí trong phòng.',
    maxLength: 500,
    nullable: true,
    type: String,
  })
  description?: unknown;
}
