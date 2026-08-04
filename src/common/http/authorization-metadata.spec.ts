import { Actors, ACTORS_KEY } from './actors.decorator';
import { RateLimit, RATE_LIMIT_KEY } from './rate-limit.decorator';
import { Roles, ROLES_KEY } from './roles.decorator';

describe('HTTP authorization metadata decorators', () => {
  it('publish actor, role and rate-limit metadata on a route handler', () => {
    class FixtureController {
      @Actors('user')
      @Roles('ADMIN', 'STAFF')
      @RateLimit({ limit: 5, windowMs: 60_000 })
      route(): void {}
    }
    const route = Object.getOwnPropertyDescriptor(
      FixtureController.prototype,
      'route',
    )?.value as object;

    expect(Reflect.getMetadata(ACTORS_KEY, route)).toEqual(['user']);
    expect(Reflect.getMetadata(ROLES_KEY, route)).toEqual(['ADMIN', 'STAFF']);
    expect(Reflect.getMetadata(RATE_LIMIT_KEY, route)).toEqual({
      limit: 5,
      windowMs: 60_000,
    });
  });
});
