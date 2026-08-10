import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';

import {
  ApiResponse,
  type ApiResponsePayload,
  Roles,
  RolesGuard,
} from '../../common/http';
import {
  ApiCommonAuthErrors,
  ApiCommonMutationErrors,
  ApiCreatedEnvelope,
  ApiOkEnvelope,
} from '../../openapi/api-response.decorators';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CreateRoomTypeDto } from './dto/create-room-type.dto';
import { AdminListRoomTypesQueryDto } from './dto/list-room-types-query.dto';
import { UpdateRoomTypeDto } from './dto/update-room-type.dto';
import { SetRoomTypeAmenitiesDto } from './dto/set-room-type-amenities.dto';
import { AdminRoomTypeDto } from './dto/room-type-response.dto';
import {
  type AdminRoomTypeResponse,
  RoomTypeService,
} from './room-type.service';

@Controller('v1/admin/room-types')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('ADMIN')
@ApiCommonAuthErrors()
export class RoomTypeAdminController {
  constructor(private readonly roomTypeService: RoomTypeService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiCreatedEnvelope(AdminRoomTypeDto)
  @ApiCommonMutationErrors()
  create(
    @Body() body: CreateRoomTypeDto,
  ): Promise<ApiResponsePayload<AdminRoomTypeResponse>> {
    return this.roomTypeService
      .create(body)
      .then((roomType) =>
        ApiResponse.created(roomType, 'Tao loai phong thanh cong.'),
      );
  }

  @Get()
  @ApiOkEnvelope(AdminRoomTypeDto, { isArray: true, paginated: true })
  list(
    @Query() query: AdminListRoomTypesQueryDto,
  ): Promise<ApiResponsePayload<AdminRoomTypeResponse[]>> {
    return this.roomTypeService
      .listAdmin(query)
      .then((result) =>
        ApiResponse.ok(
          result.items,
          'Lay danh sach loai phong thanh cong.',
          result.meta,
        ),
      );
  }

  @Get(':id')
  @ApiOkEnvelope(AdminRoomTypeDto)
  getById(
    @Param('id') id: string,
  ): Promise<ApiResponsePayload<AdminRoomTypeResponse>> {
    return this.roomTypeService
      .getAdmin(id)
      .then((roomType) =>
        ApiResponse.ok(roomType, 'Lay thong tin loai phong thanh cong.'),
      );
  }

  @Patch(':id')
  @ApiOkEnvelope(AdminRoomTypeDto)
  @ApiCommonMutationErrors()
  update(
    @Param('id') id: string,
    @Body() body: UpdateRoomTypeDto,
  ): Promise<ApiResponsePayload<AdminRoomTypeResponse>> {
    return this.roomTypeService
      .update(id, body)
      .then((roomType) =>
        ApiResponse.ok(roomType, 'Cap nhat loai phong thanh cong.'),
      );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOkEnvelope(AdminRoomTypeDto)
  @ApiCommonMutationErrors()
  softDelete(
    @Param('id') id: string,
  ): Promise<ApiResponsePayload<AdminRoomTypeResponse>> {
    return this.roomTypeService
      .softDelete(id)
      .then((roomType) =>
        ApiResponse.ok(roomType, 'Xoa loai phong thanh cong.'),
      );
  }

  @Patch(':id/restore')
  @ApiOkEnvelope(AdminRoomTypeDto)
  @ApiCommonMutationErrors()
  restore(
    @Param('id') id: string,
  ): Promise<ApiResponsePayload<AdminRoomTypeResponse>> {
    return this.roomTypeService
      .restore(id)
      .then((roomType) =>
        ApiResponse.ok(roomType, 'Khoi phuc loai phong thanh cong.'),
      );
  }

  @Put(':id/amenities')
  @ApiOkEnvelope(AdminRoomTypeDto)
  @ApiCommonMutationErrors()
  setAmenities(
    @Param('id') id: string,
    @Body() body: SetRoomTypeAmenitiesDto,
  ): Promise<ApiResponsePayload<AdminRoomTypeResponse>> {
    return this.roomTypeService
      .setAmenities(id, body)
      .then((roomType) =>
        ApiResponse.ok(roomType, 'Gan tien nghi cho loai phong thanh cong.'),
      );
  }
}
