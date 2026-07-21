import { SetMetadata } from '@nestjs/common';

import type { ActorType } from './auth.types';

export const ACTORS_KEY = 'actors';

export const Actors = (...actors: ActorType[]) =>
  SetMetadata(ACTORS_KEY, actors);
