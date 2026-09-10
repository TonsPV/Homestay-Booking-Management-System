import { Injectable } from '@nestjs/common';
import type { UserRole } from '../../common/account/account.enums';
import type { AuditActorContext } from '../audit/audit-log.service';
import type { CreateRoomDto } from './dto/create-room.dto';
import type { ListAvailableRoomsQueryDto } from './dto/list-available-rooms-query.dto';
import type { ListManagementRoomsQueryDto } from './dto/list-management-rooms-query.dto';
import type { ListRoomsQueryDto } from './dto/list-rooms-query.dto';
import type { SearchRoomsQueryDto } from './dto/search-rooms-query.dto';
import type { UpdateRoomStatusDto } from './dto/update-room-status.dto';
import type { UpdateRoomDto } from './dto/update-room.dto';
import { RoomMutationService } from './room-mutation.service';
import { RoomQueryService } from './room-query.service';
import type {
  ManagementRoomListResult,
  PublicRoomListResult,
  PublicRoomResponse,
  RoomListResult,
  RoomResponse,
} from './room.types';

export type {
  ManagementRoomListResult,
  ManagementRoomResponse,
  RoomImageResponse,
  PublicRoomListResult,
  PublicRoomResponse,
  RoomListResult,
  RoomResponse,
} from './room.types';

@Injectable()
export class RoomService {
  constructor(
    private readonly roomQuery: RoomQueryService,
    private readonly roomMutation: RoomMutationService,
  ) {}

  list(query: ListRoomsQueryDto): Promise<PublicRoomListResult> {
    return this.roomQuery.list(query);
  }

  listManagement(
    query: ListManagementRoomsQueryDto,
  ): Promise<ManagementRoomListResult> {
    return this.roomQuery.listManagement(query);
  }

  listAvailable(query: ListAvailableRoomsQueryDto): Promise<RoomListResult> {
    return this.roomQuery.listAvailable(query);
  }

  search(query: SearchRoomsQueryDto): Promise<PublicRoomListResult> {
    return this.roomQuery.search(query);
  }

  getById(id: string): Promise<PublicRoomResponse> {
    return this.roomQuery.getById(id);
  }

  getManagement(id: string): Promise<RoomResponse> {
    return this.roomQuery.getManagement(id);
  }

  create(body: CreateRoomDto): Promise<RoomResponse> {
    return this.roomMutation.create(body);
  }

  update(id: string, body: UpdateRoomDto): Promise<RoomResponse> {
    return this.roomMutation.update(id, body);
  }

  delete(id: string): Promise<RoomResponse> {
    return this.roomMutation.delete(id);
  }

  updateStatus(
    id: string,
    body: UpdateRoomStatusDto,
    role: UserRole | undefined,
    auditContext: AuditActorContext,
  ): Promise<RoomResponse> {
    return this.roomMutation.updateStatus(id, body, role, auditContext);
  }
}
