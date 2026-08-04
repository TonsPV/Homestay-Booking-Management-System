import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createPool } from 'mysql2';

import { RateLimitGuard } from '../http';
import { HealthController } from './health.controller';
import {
  HEALTH_DATABASE_POOL,
  HealthDatabaseProbeService,
} from './health-database-probe.service';

@Module({
  controllers: [HealthController],
  providers: [
    HealthDatabaseProbeService,
    RateLimitGuard,
    {
      provide: HEALTH_DATABASE_POOL,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const timeoutMs = configService.getOrThrow<number>(
          'HEALTH_DB_PROBE_TIMEOUT_MS',
        );

        return createPool({
          host: configService.getOrThrow<string>('DB_HOST'),
          port: Number(configService.getOrThrow<string>('DB_PORT')),
          user: configService.getOrThrow<string>('DB_USERNAME'),
          password: configService.getOrThrow<string>('DB_PASSWORD'),
          database: configService.getOrThrow<string>('DB_DATABASE'),
          timezone: 'Z',
          connectTimeout: timeoutMs,
          connectionLimit: 1,
          maxIdle: 1,
          waitForConnections: false,
          queueLimit: 0,
          enableKeepAlive: true,
          multipleStatements: false,
        });
      },
    },
  ],
})
export class HealthModule {}
