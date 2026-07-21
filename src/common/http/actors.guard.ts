import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ACTORS_KEY } from './actors.decorator';
import type { ActorType, AuthenticatedRequest } from './auth.types';

@Injectable()
export class ActorsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const actors = this.reflector.getAllAndOverride<ActorType[]>(ACTORS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (actors === undefined || actors.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (request.auth === undefined) {
      throw new UnauthorizedException('Access token is required.');
    }

    if (!actors.includes(request.auth.actor_type)) {
      throw new ForbiddenException('Ban khong co quyen truy cap.');
    }

    return true;
  }
}
