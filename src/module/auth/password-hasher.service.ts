import { Injectable } from '@nestjs/common';
import {
  randomBytes,
  scrypt as scryptCallback,
  timingSafeEqual,
} from 'node:crypto';

@Injectable()
export class PasswordHasherService {
  private readonly keyLength = 64;
  private readonly cost = 16384;
  private readonly blockSize = 8;
  private readonly parallelization = 1;

  async hash(password: string): Promise<string> {
    const salt = randomBytes(16);
    const derivedKey = await this.deriveKey(
      password,
      salt,
      this.keyLength,
      this.cost,
      this.blockSize,
      this.parallelization,
    );

    return [
      'scrypt',
      String(this.cost),
      String(this.blockSize),
      String(this.parallelization),
      salt.toString('base64url'),
      derivedKey.toString('base64url'),
    ].join('$');
  }

  async verify(password: string, storedHash: string | null): Promise<boolean> {
    if (storedHash === null || storedHash.length === 0) {
      return false;
    }

    const parts = storedHash.split('$');

    if (parts.length !== 6 || parts[0] !== 'scrypt') {
      return false;
    }

    const cost = Number(parts[1]);
    const blockSize = Number(parts[2]);
    const parallelization = Number(parts[3]);
    const salt = Buffer.from(parts[4], 'base64url');
    const hash = Buffer.from(parts[5], 'base64url');

    if (
      !Number.isInteger(cost) ||
      !Number.isInteger(blockSize) ||
      !Number.isInteger(parallelization) ||
      hash.length === 0
    ) {
      return false;
    }

    const derivedKey = await this.deriveKey(
      password,
      salt,
      hash.length,
      cost,
      blockSize,
      parallelization,
    );

    return (
      hash.length === derivedKey.length && timingSafeEqual(hash, derivedKey)
    );
  }

  private deriveKey(
    password: string,
    salt: Buffer,
    keyLength: number,
    cost: number,
    blockSize: number,
    parallelization: number,
  ): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      scryptCallback(
        password,
        salt,
        keyLength,
        {
          N: cost,
          r: blockSize,
          p: parallelization,
        },
        (error, derivedKey) => {
          if (error !== null) {
            reject(error);
            return;
          }

          resolve(derivedKey);
        },
      );
    });
  }
}
