import type {
  AccountStatus,
  UserRole,
} from '../../common/account/account.enums';
import type { PaginationMeta } from '../../common/pagination/pagination.types';

export interface AdminUserResponse {
  id: string;
  fullName: string;
  email: string;
  phone: string | null;
  role: UserRole;
  status: AccountStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface AdminUserListResponse {
  items: AdminUserResponse[];
  meta: PaginationMeta;
}
