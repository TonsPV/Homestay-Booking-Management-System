import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { AccessTokenService } from './access-token.service';
import {
  CustomerAuthorizationReader,
  type AuthenticatedRequest,
  UserAuthorizationReader,
} from '../../common/http';

@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly accessTokenService: AccessTokenService,
    private readonly userAuthorizationReader: UserAuthorizationReader,
    private readonly customerAuthorizationReader: CustomerAuthorizationReader,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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

    const auth = this.accessTokenService.verify(token);

    if (auth.actor_type === 'customer') {
      const customerId = auth.customer_id;
      const tokenVersion = auth.token_version;

      if (customerId === undefined || tokenVersion === undefined) {
        throw new UnauthorizedException('Invalid access token.');
      }

      const customer =
        await this.customerAuthorizationReader.findById(customerId);

      if (customer === null || customer.tokenVersion !== tokenVersion) {
        throw new UnauthorizedException('Invalid access token.');
      }

      if (customer.status === 'LOCKED') {
        throw new ForbiddenException('Tai khoan bi khoa.');
      }
    }

    if (auth.actor_type === 'user') {
      const userId = auth.user_id;
      const tokenVersion = auth.token_version;

      if (userId === undefined || tokenVersion === undefined) {
        throw new UnauthorizedException('Invalid access token.');
      }

      const user = await this.userAuthorizationReader.findById(userId);

      if (user === null || user.tokenVersion !== tokenVersion) {
        throw new UnauthorizedException('Invalid access token.');
      }

      if (user.status === 'LOCKED') {
        throw new ForbiddenException('Tai khoan bi khoa.');
      }

      auth.role = user.role;
    }

    request.auth = auth;

    return true;
  }
}
