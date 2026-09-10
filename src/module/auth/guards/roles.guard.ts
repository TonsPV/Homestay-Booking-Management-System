import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ROLES_KEY } from '../decorators/roles.decorator';
import type { UserRole } from '../../../common/account/account.enums';
import type { AuthenticatedRequest } from '../auth.types';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (roles === undefined || roles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (request.auth === undefined) {
      throw new UnauthorizedException('Access token is required.');
    }

    if (
      request.auth.actor_type !== 'user' ||
      request.auth.user_id === undefined ||
      request.auth.role === undefined
    ) {
      throw new ForbiddenException('Ban khong co quyen truy cap.');
    }

    if (!roles.includes(request.auth.role)) {
      throw new ForbiddenException('Ban khong co quyen truy cap.');
    }

    return true;
  }
}
