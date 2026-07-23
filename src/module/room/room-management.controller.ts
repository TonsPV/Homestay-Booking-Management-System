import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';

import {
  ApiResponse,
  type ApiResponsePayload,
  Roles,
  RolesGuard,
} from '../../common/http';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { ListManagementRoomsQueryDto } from './dto/list-management-rooms-query.dto';
import { RoomService, type RoomResponse } from './room.service';

@Controller('v1/management/rooms')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('ADMIN', 'STAFF')
export class RoomManagementController {
  constructor(private readonly roomService: RoomService) {}

  @Get()
  list(
    @Query() query: ListManagementRoomsQueryDto,
  ): Promise<ApiResponsePayload<RoomResponse[]>> {
    return this.roomService
      .listManagement(query)
      .then((result) =>
        ApiResponse.ok(
          result.items,
          'Lay danh sach phong quan ly thanh cong.',
          result.meta,
        ),
      );
  }

  @Get(':id')
  getById(@Param('id') id: string): Promise<ApiResponsePayload<RoomResponse>> {
    return this.roomService
      .getManagement(id)
      .then((room) =>
        ApiResponse.ok(room, 'Lay thong tin phong quan ly thanh cong.'),
      );
  }
}
