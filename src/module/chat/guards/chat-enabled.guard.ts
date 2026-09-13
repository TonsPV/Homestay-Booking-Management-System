import {
  type CanActivate,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Short-circuits the HTTP surface before authentication when chat is disabled.
 * The service repeats this check as defence in depth for non-controller calls.
 */
@Injectable()
export class ChatEnabledGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(): boolean {
    if (this.configService.get<boolean>('CHAT_ENABLED') === true) {
      return true;
    }

    throw new ServiceUnavailableException('Tinh nang chat chua duoc bat.');
  }
}
