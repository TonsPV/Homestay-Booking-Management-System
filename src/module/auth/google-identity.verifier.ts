import {
  HttpStatus,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client, type TokenPayload } from 'google-auth-library';

import { ErrorCode } from '../../common/error-codes';
import { AppHttpException } from '../../common/http/app-http-exception';
import { isEmail } from '../../common/validation';

export interface VerifiedGoogleIdentity {
  email: string;
  fullName: string;
  emailVerified: true;
  subject: string;
}

/** Verifies Google ID tokens without exposing provider tokens to the domain. */
@Injectable()
export class GoogleIdentityVerifier {
  private readonly enabled: boolean;
  private readonly clientId: string;
  private readonly client: OAuth2Client;

  constructor(configService: ConfigService) {
    this.enabled = configService.get<boolean>('GOOGLE_AUTH_ENABLED') === true;
    this.clientId = configService.get<string>('GOOGLE_CLIENT_ID')?.trim() ?? '';
    this.client = new OAuth2Client();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  async verify(credential: string): Promise<VerifiedGoogleIdentity> {
    if (!this.enabled || this.clientId.length === 0) {
      throw new ServiceUnavailableException(
        'Dang nhap Google chua duoc cau hinh.',
      );
    }

    let payload: TokenPayload | undefined;

    try {
      const ticket = await this.client.verifyIdToken({
        idToken: credential,
        audience: this.clientId,
      });
      payload = ticket.getPayload();
    } catch {
      throw this.invalidCredential();
    }

    if (
      payload === undefined ||
      typeof payload.sub !== 'string' ||
      payload.sub.trim().length === 0 ||
      typeof payload.email !== 'string' ||
      payload.email.trim().length === 0 ||
      payload.email_verified !== true ||
      payload.sub.length > 255
    ) {
      throw this.invalidCredential();
    }

    const email = payload.email.trim().toLowerCase();

    if (email.length > 160 || !isEmail(email)) {
      throw this.invalidCredential();
    }
    const fullName =
      typeof payload.name === 'string' && payload.name.trim().length > 0
        ? payload.name.trim().slice(0, 120)
        : email.split('@')[0]?.slice(0, 120) || 'Google customer';

    return {
      email,
      emailVerified: true,
      fullName,
      subject: payload.sub,
    };
  }

  private invalidCredential(): AppHttpException {
    return new AppHttpException(
      HttpStatus.UNAUTHORIZED,
      ErrorCode.AUTH_GOOGLE_INVALID_TOKEN,
      'Google credential khong hop le.',
    );
  }
}
