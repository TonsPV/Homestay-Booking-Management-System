import { SetMetadata } from '@nestjs/common';

import type { ActorType } from '../../../common/domain/account.enums';

export const ACTORS_KEY = 'actors';

export const Actors = (actor: ActorType, ...actors: ActorType[]) =>
  SetMetadata(ACTORS_KEY, [actor, ...actors]);
