import { Controller, Get, Param, Query } from '@nestjs/common';

import { ApiResponse, type ApiResponsePayload } from '../../common/http';
import { ListRoomTypesQueryDto } from './dto/list-room-types-query.dto';
import { RoomTypeService, type RoomTypeResponse } from './room-type.service';

@Controller('v1/room-types')
export class RoomTypeController {
  constructor(private readonly roomTypeService: RoomTypeService) {}

  @Get()
  list(
    @Query() query: ListRoomTypesQueryDto,
  ): Promise<ApiResponsePayload<RoomTypeResponse[]>> {
    return this.roomTypeService
      .listPublic(query)
      .then((result) =>
        ApiResponse.ok(
          result.items,
          'Lay danh sach loai phong thanh cong.',
          result.meta,
        ),
      );
  }

  @Get(':id')
  getById(
    @Param('id') id: string,
  ): Promise<ApiResponsePayload<RoomTypeResponse>> {
    return this.roomTypeService
      .getPublic(id)
      .then((roomType) =>
        ApiResponse.ok(roomType, 'Lay thong tin loai phong thanh cong.'),
      );
  }
}
