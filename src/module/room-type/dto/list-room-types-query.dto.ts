export class ListRoomTypesQueryDto {
  page?: unknown;
  limit?: unknown;
  search?: unknown;
}

export class AdminListRoomTypesQueryDto extends ListRoomTypesQueryDto {
  includeDeleted?: unknown;
}
