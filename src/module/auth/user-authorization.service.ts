import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';

import {
  UserAuthorizationReader,
  type UserAuthorizationState,
} from './authorization/user-authorization-reader';
import { User } from '../user/schema/user.entity';

@Injectable()
export class UserAuthorizationService extends UserAuthorizationReader {
  constructor(
    @InjectRepository(User)
    private readonly usersRepository: Repository<User>,
  ) {
    super();
  }

  async findById(id: string): Promise<UserAuthorizationState | null> {
    const user = await this.usersRepository.findOneBy({ id });

    if (user === null) {
      return null;
    }

    return {
      id: user.id,
      role: user.role,
      status: user.status,
      tokenVersion: user.tokenVersion,
    };
  }
}
