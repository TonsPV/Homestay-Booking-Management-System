import { SetMetadata } from '@nestjs/common';

import type { UserRole } from '../../../common/domain/account.enums';

export const ROLES_KEY = 'roles';

export const Roles = (role: UserRole, ...roles: UserRole[]) =>
  SetMetadata(ROLES_KEY, [role, ...roles]);
