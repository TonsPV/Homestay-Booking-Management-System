import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { AccessTokenService } from './access-token.service';
import type { AuthenticatedRequest } from '../../common/http';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(private readonly accessTokenService: AccessTokenService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;

    if (typeof authorization !== 'string') {
      throw new UnauthorizedException(
        'Authorization bearer token is required.',
      );
    }

    const [scheme, token] = authorization.split(' ');

    if (scheme !== 'Bearer' || token === undefined || token.length === 0) {
      throw new UnauthorizedException(
        'Authorization bearer token is required.',
      );
    }

    request.auth = this.accessTokenService.verify(token);

    return true;
  }
}
