import {
  Controller,
  Get,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';

import { RateLimit, RateLimitGuard } from '../http';
import { ApiOkEnvelope } from '../../openapi/api-response.decorators';
import {
  ApiRateLimitError,
  ApiReadinessError,
} from '../../openapi/api-response.decorators';
import { HealthDatabaseProbeService } from './health-database-probe.service';
import { HealthResponseDto } from './health-response.dto';

@Controller('health')
export class HealthController {
  constructor(
    private readonly healthDatabaseProbeService: HealthDatabaseProbeService,
  ) {}

  @Get('live')
  @ApiOkEnvelope(HealthResponseDto)
  getLiveness(): HealthResponseDto {
    return this.createHealthyResponse();
  }

  @Get('ready')
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 30, windowMs: 60_000 })
  @ApiOkEnvelope(HealthResponseDto)
  @ApiReadinessError()
  @ApiRateLimitError()
  async getReadiness(): Promise<HealthResponseDto> {
    try {
      await this.healthDatabaseProbeService.check();
    } catch {
      throw new ServiceUnavailableException('Database is unavailable.');
    }

    return this.createHealthyResponse();
  }

  private createHealthyResponse(): HealthResponseDto {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
    };
  }
}
