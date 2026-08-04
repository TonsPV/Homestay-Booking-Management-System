import { ServiceUnavailableException } from '@nestjs/common';

import { RATE_LIMIT_KEY } from '../http/rate-limit.decorator';
import { HealthController } from './health.controller';
import type { HealthDatabaseProbeService } from './health-database-probe.service';

describe('HealthController', () => {
  let check: jest.Mock;
  let controller: HealthController;

  beforeEach(() => {
    check = jest.fn();
    controller = new HealthController({
      check,
    } as unknown as HealthDatabaseProbeService);
  });

  it('reports liveness without querying the database', () => {
    expect(controller.getLiveness()).toEqual({
      status: 'ok',
      timestamp: expect.any(String) as string,
    });
    expect(check).not.toHaveBeenCalled();
  });

  it('reports readiness after a successful database probe', async () => {
    check.mockResolvedValue(undefined);

    await expect(controller.getReadiness()).resolves.toEqual({
      status: 'ok',
      timestamp: expect.any(String) as string,
    });
    expect(check).toHaveBeenCalledTimes(1);
  });

  it('throws 503 without exposing the database error', async () => {
    check.mockRejectedValue(new Error('secret host details'));

    await expect(controller.getReadiness()).rejects.toEqual(
      new ServiceUnavailableException('Database is unavailable.'),
    );
  });

  it('rate-limits readiness without applying the limit to liveness', () => {
    const readinessHandler = Object.getOwnPropertyDescriptor(
      HealthController.prototype,
      'getReadiness',
    )?.value as () => Promise<unknown>;
    const livenessHandler = Object.getOwnPropertyDescriptor(
      HealthController.prototype,
      'getLiveness',
    )?.value as () => unknown;

    expect(Reflect.getMetadata(RATE_LIMIT_KEY, readinessHandler)).toEqual({
      limit: 30,
      windowMs: 60_000,
    });
    expect(
      Reflect.getMetadata(RATE_LIMIT_KEY, livenessHandler),
    ).toBeUndefined();
  });
});
