import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateAmenityDto {
  @ApiPropertyOptional({
    example: 'Wi-Fi tốc độ cao',
    maxLength: 120,
    type: String,
  })
  name?: unknown;

  @ApiPropertyOptional({
    example: 'Internet không dây miễn phí trong phòng.',
    maxLength: 500,
    nullable: true,
    type: String,
  })
  description?: unknown;
}
