import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'node:crypto';

import { parseDurationToSeconds } from '../../config/duration';
import type { AccessTokenPayload, AccessTokenSubject } from './auth.types';

@Injectable()
export class AccessTokenService {
  private readonly algorithm = 'HS256';
  private readonly tokenType = 'JWT';
  private readonly maxClockSkewSeconds = 60;

  constructor(private readonly configService: ConfigService) {}

  getExpiresInSeconds(): number {
    const value = this.configService.getOrThrow<string>(
      'JWT_ACCESS_TOKEN_EXPIRES_IN',
    );

    try {
      return parseDurationToSeconds(value);
    } catch {
      throw new Error('JWT access token duration is invalid.');
    }
  }

  sign(subject: AccessTokenSubject): string {
    const now = Math.floor(Date.now() / 1000);
    const expiresIn = this.getExpiresInSeconds();
    const payload: AccessTokenPayload = {
      sub: this.getSubject(subject),
      actor_type: subject.actorType,
      iat: now,
      exp: now + expiresIn,
    };

    if (subject.actorType === 'customer') {
      payload.customer_id = this.requireId(subject.customerId);
      payload.token_version = this.requireTokenVersion(subject.tokenVersion);
    }

    if (subject.actorType === 'user') {
      payload.user_id = this.requireId(subject.userId);
      payload.token_version = this.requireTokenVersion(subject.tokenVersion);

      if (subject.role !== undefined) {
        payload.role = subject.role;
      }
    }

    const header = {
      alg: this.algorithm,
      typ: this.tokenType,
    };
    const encodedHeader = this.encodeJson(header);
    const encodedPayload = this.encodeJson(payload);
    const signature = this.signSegments(encodedHeader, encodedPayload);

    return `${encodedHeader}.${encodedPayload}.${signature}`;
  }

  verify(token: string): AccessTokenPayload {
    const segments = token.split('.');

    if (segments.length !== 3) {
      throw new UnauthorizedException('Invalid access token.');
    }

    const [encodedHeader, encodedPayload, signature] = segments;
    const expectedSignature = this.signSegments(encodedHeader, encodedPayload);

    if (!this.safeEquals(signature, expectedSignature)) {
      throw new UnauthorizedException('Invalid access token.');
    }

    const header = this.decodeJson(encodedHeader);

    if (header.alg !== this.algorithm || header.typ !== this.tokenType) {
      throw new UnauthorizedException('Invalid access token.');
    }

    const payload = this.decodeJson(encodedPayload);
    const accessTokenPayload = this.toAccessTokenPayload(payload);
    const now = Math.floor(Date.now() / 1000);

    if (
      accessTokenPayload.iat > now + this.maxClockSkewSeconds ||
      accessTokenPayload.exp <= accessTokenPayload.iat
    ) {
      throw new UnauthorizedException('Invalid access token.');
    }

    if (accessTokenPayload.exp <= now) {
      throw new UnauthorizedException('Access token has expired.');
    }

    return accessTokenPayload;
  }

  private getSecret(): string {
    return this.configService.getOrThrow<string>('JWT_ACCESS_TOKEN_SECRET');
  }

  private getSubject(subject: AccessTokenSubject): string {
    if (subject.actorType === 'customer') {
      return `customer:${this.requireId(subject.customerId)}`;
    }

    return `user:${this.requireId(subject.userId)}`;
  }

  private requireId(value: string | undefined): string {
    if (value === undefined || value.length === 0) {
      throw new Error('Access token subject id is required.');
    }

    return value;
  }

  private encodeJson(value: unknown): string {
    return Buffer.from(JSON.stringify(value), 'utf8').toString('base64url');
  }

  private decodeJson(segment: string): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(
        Buffer.from(segment, 'base64url').toString('utf8'),
      );

      if (
        parsed === null ||
        typeof parsed !== 'object' ||
        Array.isArray(parsed)
      ) {
        throw new UnauthorizedException('Invalid access token.');
      }

      return parsed as Record<string, unknown>;
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        throw error;
      }

      throw new UnauthorizedException('Invalid access token.');
    }
  }

  private signSegments(encodedHeader: string, encodedPayload: string): string {
    return createHmac('sha256', this.getSecret())
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest('base64url');
  }

  private safeEquals(actual: string, expected: string): boolean {
    const actualBuffer = Buffer.from(actual);
    const expectedBuffer = Buffer.from(expected);

    return (
      actualBuffer.length === expectedBuffer.length &&
      timingSafeEqual(actualBuffer, expectedBuffer)
    );
  }

  private toAccessTokenPayload(
    payload: Record<string, unknown>,
  ): AccessTokenPayload {
    const sub = this.readString(payload, 'sub');
    const actorType = payload.actor_type;
    const iat = this.readNumber(payload, 'iat');
    const exp = this.readNumber(payload, 'exp');

    if (actorType !== 'customer' && actorType !== 'user') {
      throw new UnauthorizedException('Invalid access token.');
    }

    if (actorType === 'customer') {
      const customerId = this.readString(payload, 'customer_id');
      const tokenVersion = this.readTokenVersion(payload, 'token_version');

      if (sub !== `customer:${customerId}`) {
        throw new UnauthorizedException('Invalid access token.');
      }

      return {
        sub,
        actor_type: actorType,
        customer_id: customerId,
        token_version: tokenVersion,
        iat,
        exp,
      };
    }

    const userId = this.readString(payload, 'user_id');
    const role = this.readOptionalRole(payload, 'role');
    const tokenVersion = this.readTokenVersion(payload, 'token_version');

    if (sub !== `user:${userId}`) {
      throw new UnauthorizedException('Invalid access token.');
    }

    return {
      sub,
      actor_type: actorType,
      user_id: userId,
      role,
      token_version: tokenVersion,
      iat,
      exp,
    };
  }

  private readString(payload: Record<string, unknown>, key: string): string {
    const value = payload[key];

    if (typeof value !== 'string' || value.length === 0) {
      throw new UnauthorizedException('Invalid access token.');
    }

    return value;
  }

  private readOptionalString(
    payload: Record<string, unknown>,
    key: string,
  ): string | undefined {
    const value = payload[key];

    if (value === undefined) {
      return undefined;
    }

    if (typeof value !== 'string' || value.length === 0) {
      throw new UnauthorizedException('Invalid access token.');
    }

    return value;
  }

  private readOptionalRole(
    payload: Record<string, unknown>,
    key: string,
  ): 'STAFF' | 'ADMIN' | undefined {
    const value = this.readOptionalString(payload, key);

    if (value === undefined) {
      return undefined;
    }

    if (value !== 'STAFF' && value !== 'ADMIN') {
      throw new UnauthorizedException('Invalid access token.');
    }

    return value;
  }

  private readNumber(payload: Record<string, unknown>, key: string): number {
    const value = payload[key];

    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new UnauthorizedException('Invalid access token.');
    }

    return value;
  }

  private requireTokenVersion(value: number | undefined): number {
    if (value === undefined || !Number.isInteger(value) || value < 0) {
      throw new Error('User token version is required.');
    }

    return value;
  }

  private readTokenVersion(
    payload: Record<string, unknown>,
    key: string,
  ): number {
    const value = this.readNumber(payload, key);

    if (value < 0) {
      throw new UnauthorizedException('Invalid access token.');
    }

    return value;
  }
}
