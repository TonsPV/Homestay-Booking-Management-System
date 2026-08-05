import { ApiProperty } from '@nestjs/swagger';
import { Allow } from 'class-validator';

export class DashboardSummaryQueryDto {
  @ApiProperty({ example: '2026-07-01', format: 'date', type: String })
  @Allow()
  from!: unknown;

  @ApiProperty({ example: '2026-07-27', format: 'date', type: String })
  @Allow()
  to!: unknown;
}
