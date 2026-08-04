import type { ConfigService } from '@nestjs/config';
import {
  createPool,
  type Pool,
  type PoolConnection,
  type QueryError,
  type QueryOptions,
} from 'mysql2';

import { HealthDatabaseProbeService } from '../src/common/health/health-database-probe.service';

describe('Health probe timeout against MySQL (e2e)', () => {
  it('destroys the timed-out connection and immediately frees the one-slot pool', async () => {
    const timeoutMs = 200;
    const realPool = createPool({
      host: requireEnvironment('DB_HOST'),
      port: Number(requireEnvironment('DB_PORT')),
      user: requireEnvironment('DB_USERNAME'),
      password: requireEnvironment('DB_PASSWORD'),
      database: requireEnvironment('DB_DATABASE'),
      timezone: 'Z',
      connectTimeout: 1000,
      connectionLimit: 1,
      maxIdle: 1,
      waitForConnections: false,
      queueLimit: 0,
      multipleStatements: false,
    });
    const probePool = {
      getConnection: (
        callback: (
          error: NodeJS.ErrnoException | null,
          connection: PoolConnection,
        ) => void,
      ): void => {
        realPool.getConnection((error, connection) => {
          if (error !== null) {
            callback(error, connection);
            return;
          }

          callback(null, createStalledConnection(connection));
        });
      },
      end: realPool.end.bind(realPool),
    } as unknown as Pool;
    const service = new HealthDatabaseProbeService(probePool, {
      getOrThrow: jest.fn(() => timeoutMs),
    } as unknown as ConfigService);
    const startedAt = Date.now();

    try {
      await expect(service.check()).rejects.toThrow();

      expect(Date.now() - startedAt).toBeLessThan(1500);
      await expect(
        realPool.promise().query('SELECT 1 AS result'),
      ).resolves.toEqual(
        expect.arrayContaining([expect.any(Array), expect.any(Array)]),
      );
    } finally {
      await service.onApplicationShutdown();
    }
  });
});

function createStalledConnection(connection: PoolConnection): PoolConnection {
  return new Proxy(connection, {
    get(target, property, receiver) {
      if (property === 'query') {
        return (
          options: QueryOptions,
          callback: (error: QueryError | null) => void,
        ) => {
          target.query(
            {
              ...options,
              sql: 'SELECT SLEEP(2) AS delayed',
            },
            callback,
          );
        };
      }

      if (property === 'destroy') {
        return (): void => target.destroy();
      }

      if (property === 'release') {
        return (): void => target.release();
      }

      return Reflect.get(target, property, receiver) as unknown;
    },
  });
}

function requireEnvironment(key: string): string {
  const value = process.env[key];

  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${key} is required for the MySQL health timeout E2E.`);
  }

  return value;
}
