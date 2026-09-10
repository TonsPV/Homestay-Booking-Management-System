import { Controller, Get, Param, Query } from '@nestjs/common';

import { ApiResponse, type ApiResponsePayload } from '../../common/http';
import { ApiOkEnvelope } from '../../openapi/api-response.decorators';
import { ListRoomTypesQueryDto } from './dto/list-room-types-query.dto';
import { RoomTypeDto } from './dto/room-type-response.dto';
import { RoomTypeService } from './room-type.service';
import { type RoomTypeResponse } from './room-type.types';

@Controller('v1/room-types')
export class RoomTypeController {
  constructor(private readonly roomTypeService: RoomTypeService) {}

  @Get()
  @ApiOkEnvelope(RoomTypeDto, { isArray: true, paginated: true })
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
  @ApiOkEnvelope(RoomTypeDto)
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
