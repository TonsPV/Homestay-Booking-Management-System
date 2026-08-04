import { ApiProperty } from '@nestjs/swagger';

export class DashboardSummaryQueryDto {
  @ApiProperty({ example: '2026-07-01', format: 'date', type: String })
  from!: unknown;

  @ApiProperty({ example: '2026-07-27', format: 'date', type: String })
  to!: unknown;
}
