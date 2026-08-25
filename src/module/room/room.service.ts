import { Injectable } from '@nestjs/common';
import type { UserRole } from '../../common/domain/account.enums';
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
    private readonly roomQueryService: RoomQueryService,
    private readonly roomMutationService: RoomMutationService,
  ) {}

  list(query: ListRoomsQueryDto): Promise<PublicRoomListResult> {
    return this.roomQueryService.list(query);
  }

  listManagement(
    query: ListManagementRoomsQueryDto,
  ): Promise<ManagementRoomListResult> {
    return this.roomQueryService.listManagement(query);
  }

  listAvailable(query: ListAvailableRoomsQueryDto): Promise<RoomListResult> {
    return this.roomQueryService.listAvailable(query);
  }

  search(query: SearchRoomsQueryDto): Promise<PublicRoomListResult> {
    return this.roomQueryService.search(query);
  }

  getById(id: string): Promise<PublicRoomResponse> {
    return this.roomQueryService.getById(id);
  }

  getManagement(id: string): Promise<RoomResponse> {
    return this.roomQueryService.getManagement(id);
  }

  create(body: CreateRoomDto): Promise<RoomResponse> {
    return this.roomMutationService.create(body);
  }

  update(id: string, body: UpdateRoomDto): Promise<RoomResponse> {
    return this.roomMutationService.update(id, body);
  }

  delete(id: string): Promise<RoomResponse> {
    return this.roomMutationService.delete(id);
  }

  updateStatus(
    id: string,
    body: UpdateRoomStatusDto,
    role: UserRole | undefined,
    auditContext: AuditActorContext,
  ): Promise<RoomResponse> {
    return this.roomMutationService.updateStatus(id, body, role, auditContext);
  }
}
