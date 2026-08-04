import {
  Inject,
  Injectable,
  OnApplicationShutdown,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Pool, PoolConnection, QueryError } from 'mysql2';

export const HEALTH_DATABASE_POOL = Symbol('HEALTH_DATABASE_POOL');

@Injectable()
export class HealthDatabaseProbeService implements OnApplicationShutdown {
  private readonly timeoutMs: number;
  private probeRunning = false;
  private shuttingDown = false;
  private activeConnection: PoolConnection | null = null;
  private abortActiveProbe: (() => void) | null = null;

  constructor(
    @Inject(HEALTH_DATABASE_POOL)
    private readonly pool: Pool,
    configService: ConfigService,
  ) {
    this.timeoutMs = configService.getOrThrow<number>(
      'HEALTH_DB_PROBE_TIMEOUT_MS',
    );
  }

  async check(): Promise<void> {
    if (this.shuttingDown || this.probeRunning) {
      throw new ServiceUnavailableException('Database is unavailable.');
    }

    this.probeRunning = true;

    try {
      await this.executeProbe();
    } finally {
      this.probeRunning = false;
      this.activeConnection = null;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.shuttingDown = true;
    const abortActiveProbe = this.abortActiveProbe;

    if (abortActiveProbe !== null) {
      abortActiveProbe();
    } else {
      this.activeConnection?.destroy();
    }

    this.activeConnection = null;

    await new Promise<void>((resolve) => {
      this.pool.end(() => resolve());
    });
  }

  private executeProbe(): Promise<void> {
    return new Promise((resolve, reject) => {
      let completed = false;
      let connection: PoolConnection | null = null;
      const finish = (
        error: Error | QueryError | null,
        destroyConnection: boolean,
      ): void => {
        if (completed) {
          return;
        }

        completed = true;
        this.abortActiveProbe = null;

        clearTimeout(timeoutHandle);

        if (connection !== null) {
          if (destroyConnection || error !== null) {
            connection.destroy();
          } else {
            connection.release();
          }
        }

        if (error !== null) {
          reject(error);
          return;
        }

        resolve();
      };

      const timeoutHandle = setTimeout(() => {
        finish(new Error('Database health probe timed out.'), true);
      }, this.timeoutMs);
      this.abortActiveProbe = () => {
        finish(new Error('Database health probe was stopped.'), true);
      };

      this.pool.getConnection((acquireError, acquiredConnection) => {
        if (completed) {
          acquiredConnection?.destroy();
          return;
        }

        if (acquireError !== null) {
          finish(acquireError, true);
          return;
        }

        connection = acquiredConnection;
        this.activeConnection = acquiredConnection;
        acquiredConnection.query(
          {
            sql: `SELECT /*+ MAX_EXECUTION_TIME(${this.timeoutMs}) */ 1 AS result`,
            timeout: this.timeoutMs,
          },
          (queryError) => {
            finish(queryError, queryError !== null);
          },
        );
      });
    });
  }
}
