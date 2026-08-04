export enum ActorTypeEnum {
  CUSTOMER = 'customer',
  USER = 'user',
}

export enum UserRoleEnum {
  STAFF = 'STAFF',
  ADMIN = 'ADMIN',
}

export enum AccountStatusEnum {
  ACTIVE = 'ACTIVE',
  LOCKED = 'LOCKED',
}

export type ActorType = `${ActorTypeEnum}`;
export type UserRole = `${UserRoleEnum}`;
export type AccountStatus = `${AccountStatusEnum}`;
