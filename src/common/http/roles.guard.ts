import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ROLES_KEY } from './roles.decorator';
import type { AuthenticatedRequest, UserRole } from './auth.types';
import { UserAuthorizationReader } from './user-authorization-reader';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly userAuthorizationReader: UserAuthorizationReader,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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
      request.auth.user_id === undefined
    ) {
      throw new ForbiddenException('Ban khong co quyen truy cap.');
    }

    const user = await this.userAuthorizationReader.findById(
      request.auth.user_id,
    );

    if (user === null) {
      throw new UnauthorizedException('Access token is invalid.');
    }

    if (user.status === 'LOCKED') {
      throw new ForbiddenException('Tai khoan bi khoa.');
    }

    request.auth.role = user.role;

    if (!roles.includes(user.role)) {
      throw new ForbiddenException('Ban khong co quyen truy cap.');
    }

    return true;
  }
}
