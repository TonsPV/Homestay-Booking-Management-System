import {
  Actors,
  ACTORS_KEY,
} from '../../../../src/module/auth/decorators/actors.decorator';
import {
  RateLimit,
  RATE_LIMIT_KEY,
} from '../../../../src/common/http/rate-limit.decorator';
import {
  Roles,
  ROLES_KEY,
} from '../../../../src/module/auth/decorators/roles.decorator';
import { BookingManagementController } from '../../../../src/module/booking/booking-management.controller';

describe('HTTP authorization metadata decorators', () => {
  it('publish actor, role and rate-limit metadata on a route handler', () => {
    class FixtureController {
      @Actors('user')
      @Roles('ADMIN', 'STAFF')
      @RateLimit({ limit: 5, windowMs: 60_000 })
      route(): void {}

      @Roles('ADMIN')
      singleRoleRoute(): void {}
    }
    const route = Object.getOwnPropertyDescriptor(
      FixtureController.prototype,
      'route',
    )?.value as object;
    const singleRoleRoute = Object.getOwnPropertyDescriptor(
      FixtureController.prototype,
      'singleRoleRoute',
    )?.value as object;

    expect(Reflect.getMetadata(ACTORS_KEY, route)).toEqual(['user']);
    expect(Reflect.getMetadata(ROLES_KEY, route)).toEqual(['ADMIN', 'STAFF']);
    expect(Reflect.getMetadata(ROLES_KEY, singleRoleRoute)).toEqual(['ADMIN']);
    expect(Reflect.getMetadata(RATE_LIMIT_KEY, route)).toEqual({
      limit: 5,
      windowMs: 60_000,
    });
  });

  it('restricts counter booking creation to STAFF without narrowing other management routes', () => {
    const createRoute = Object.getOwnPropertyDescriptor(
      BookingManagementController.prototype,
      'create',
    )?.value as object;

    expect(Reflect.getMetadata(ROLES_KEY, createRoute)).toEqual(['STAFF']);
    expect(Reflect.getMetadata(ROLES_KEY, BookingManagementController)).toEqual(
      ['ADMIN', 'STAFF'],
    );
  });
});
