import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class UpdateAmenityDto {
  @ApiPropertyOptional({
    example: 'Wi-Fi tốc độ cao',
    maxLength: 120,
    type: String,
  })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({
    example: 'Internet không dây miễn phí trong phòng.',
    maxLength: 500,
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsString()
  description?: string | null;
}
