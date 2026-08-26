import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Pool, PoolConnection, QueryError } from 'mysql2';

import { HealthDatabaseProbeService } from '../../../../src/common/health/health-database-probe.service';

describe('HealthDatabaseProbeService', () => {
  let pool: {
    getConnection: jest.Mock;
    end: jest.Mock;
  };
  let connection: {
    query: jest.Mock;
    release: jest.Mock;
    destroy: jest.Mock;
  };
  let service: HealthDatabaseProbeService;

  beforeEach(() => {
    connection = {
      query: jest.fn(),
      release: jest.fn(),
      destroy: jest.fn(),
    };
    pool = {
      getConnection: jest.fn(),
      end: jest.fn((callback: (error: QueryError | null) => void) =>
        callback(null),
      ),
    };
    service = new HealthDatabaseProbeService(
      pool as unknown as Pool,
      {
        getOrThrow: jest.fn(() => 1000),
      } as unknown as ConfigService,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('releases a dedicated connection after a successful bounded query', async () => {
    pool.getConnection.mockImplementation(
      (callback: (error: null, value: PoolConnection) => void) =>
        callback(null, connection as unknown as PoolConnection),
    );
    connection.query.mockImplementation(
      (
        options: { sql: string; timeout: number },
        callback: (error: null) => void,
      ) => {
        expect(options).toEqual({
          sql: 'SELECT /*+ MAX_EXECUTION_TIME(1000) */ 1 AS result',
          timeout: 1000,
        });
        callback(null);
      },
    );

    await expect(service.check()).resolves.toBeUndefined();
    expect(connection.release).toHaveBeenCalledTimes(1);
    expect(connection.destroy).not.toHaveBeenCalled();
  });

  it('destroys the connection when the query fails', async () => {
    const queryError = new Error('query failed') as QueryError;

    pool.getConnection.mockImplementation(
      (callback: (error: null, value: PoolConnection) => void) =>
        callback(null, connection as unknown as PoolConnection),
    );
    connection.query.mockImplementation(
      (
        _options: { sql: string; timeout: number },
        callback: (error: QueryError) => void,
      ) => callback(queryError),
    );

    await expect(service.check()).rejects.toBe(queryError);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(connection.release).not.toHaveBeenCalled();
  });

  it('destroys a hung query connection when the deadline expires', async () => {
    jest.useFakeTimers();
    pool.getConnection.mockImplementation(
      (callback: (error: null, value: PoolConnection) => void) =>
        callback(null, connection as unknown as PoolConnection),
    );
    connection.query.mockImplementation(() => undefined);
    const probe = service.check();
    const probeExpectation = expect(probe).rejects.toThrow(
      'Database health probe timed out.',
    );

    await jest.advanceTimersByTimeAsync(1000);

    await probeExpectation;
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(connection.release).not.toHaveBeenCalled();
  });

  it('destroys a connection acquired after the acquisition deadline', async () => {
    jest.useFakeTimers();
    let acquisitionCallback:
      ((error: null, value: PoolConnection) => void) | undefined;

    pool.getConnection.mockImplementation(
      (callback: (error: null, value: PoolConnection) => void) => {
        acquisitionCallback = callback;
      },
    );
    const probe = service.check();
    const probeExpectation = expect(probe).rejects.toThrow(
      'Database health probe timed out.',
    );

    await jest.advanceTimersByTimeAsync(1000);
    await probeExpectation;

    acquisitionCallback?.(null, connection as unknown as PoolConnection);
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(connection.query).not.toHaveBeenCalled();
  });

  it('rejects concurrent probes before starting another acquisition', async () => {
    let finishQuery: ((error: null) => void) | undefined;

    pool.getConnection.mockImplementation(
      (callback: (error: null, value: PoolConnection) => void) =>
        callback(null, connection as unknown as PoolConnection),
    );
    connection.query.mockImplementation(
      (
        _options: { sql: string; timeout: number },
        callback: (error: null) => void,
      ) => {
        finishQuery = callback;
      },
    );
    const firstProbe = service.check();

    await expect(service.check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(pool.getConnection).toHaveBeenCalledTimes(1);

    finishQuery?.(null);
    await expect(firstProbe).resolves.toBeUndefined();
  });

  it('destroys active work and closes the health pool during shutdown', async () => {
    pool.getConnection.mockImplementation(
      (callback: (error: null, value: PoolConnection) => void) =>
        callback(null, connection as unknown as PoolConnection),
    );
    connection.query.mockImplementation(() => undefined);
    const activeProbe = service.check();
    const activeProbeExpectation = expect(activeProbe).rejects.toThrow(
      'Database health probe was stopped.',
    );

    await service.onApplicationShutdown();

    await activeProbeExpectation;
    expect(connection.destroy).toHaveBeenCalledTimes(1);
    expect(pool.end).toHaveBeenCalledTimes(1);
    await expect(service.check()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
