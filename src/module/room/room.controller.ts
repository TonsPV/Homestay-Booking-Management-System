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
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { FileInterceptor } from '@nestjs/platform-express';

import {
  ApiResponse,
  type ApiResponsePayload,
  CurrentAuth,
  Roles,
  RolesGuard,
  type AccessTokenPayload,
} from '../../common/http';
import { ROOM_IMAGE_MAX_FILE_SIZE } from '../../config/room-image-storage';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { CreateRoomImageDto } from './dto/create-room-image.dto';
import { CreateRoomDto } from './dto/create-room.dto';
import { ListRoomsQueryDto } from './dto/list-rooms-query.dto';
import { SearchRoomsQueryDto } from './dto/search-rooms-query.dto';
import { UpdateRoomStatusDto } from './dto/update-room-status.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { RoomImageService } from './room-image.service';
import type { UploadedRoomImageFile } from './room-image-storage.service';
import {
  type RoomImageResponse,
  type RoomResponse,
  RoomService,
} from './room.service';

@Controller('v1/rooms')
export class RoomController {
  constructor(
    private readonly roomService: RoomService,
    private readonly roomImageService: RoomImageService,
  ) {}

  @Get('search')
  search(
    @Query() query: SearchRoomsQueryDto,
  ): Promise<ApiResponsePayload<RoomResponse[]>> {
    return this.roomService
      .search(query)
      .then((result) =>
        ApiResponse.ok(
          result.items,
          'Tim phong trong thanh cong.',
          result.meta,
        ),
      );
  }

  @Get()
  list(
    @Query() query: ListRoomsQueryDto,
  ): Promise<ApiResponsePayload<RoomResponse[]>> {
    return this.roomService
      .list(query)
      .then((result) =>
        ApiResponse.ok(
          result.items,
          'Lay danh sach phong thanh cong.',
          result.meta,
        ),
      );
  }

  @Get(':id')
  getById(@Param('id') id: string): Promise<ApiResponsePayload<RoomResponse>> {
    return this.roomService
      .getById(id)
      .then((room) => ApiResponse.ok(room, 'Lay thong tin phong thanh cong.'));
  }

  @Post()
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('ADMIN')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() body: CreateRoomDto,
  ): Promise<ApiResponsePayload<RoomResponse>> {
    return this.roomService
      .create(body)
      .then((room) => ApiResponse.created(room, 'Tao phong thanh cong.'));
  }

  @Patch(':id')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('ADMIN')
  update(
    @Param('id') id: string,
    @Body() body: UpdateRoomDto,
  ): Promise<ApiResponsePayload<RoomResponse>> {
    return this.roomService
      .update(id, body)
      .then((room) => ApiResponse.ok(room, 'Cap nhat phong thanh cong.'));
  }

  @Delete(':id')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('ADMIN')
  @HttpCode(HttpStatus.OK)
  delete(@Param('id') id: string): Promise<ApiResponsePayload<RoomResponse>> {
    return this.roomService
      .delete(id)
      .then((room) => ApiResponse.ok(room, 'Xoa phong thanh cong.'));
  }

  @Patch(':id/status')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('ADMIN', 'STAFF')
  updateStatus(
    @Param('id') id: string,
    @Body() body: UpdateRoomStatusDto,
    @CurrentAuth() auth: AccessTokenPayload,
  ): Promise<ApiResponsePayload<RoomResponse>> {
    return this.roomService
      .updateStatus(id, body, auth.role)
      .then((room) =>
        ApiResponse.ok(room, 'Cap nhat trang thai phong thanh cong.'),
      );
  }

  @Post(':roomId/images')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
        isCover: {
          type: 'boolean',
          example: true,
        },
        sortOrder: {
          type: 'integer',
          example: 0,
          minimum: 0,
        },
      },
    },
  })
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles('ADMIN')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fields: 2,
        files: 1,
        fileSize: ROOM_IMAGE_MAX_FILE_SIZE,
        parts: 4,
      },
    }),
  )
  @HttpCode(HttpStatus.CREATED)
  createImage(
    @Param('roomId') roomId: string,
    @Body() body: CreateRoomImageDto,
    @UploadedFile() file?: UploadedRoomImageFile,
  ): Promise<ApiResponsePayload<RoomImageResponse>> {
    return this.roomImageService
      .create(roomId, body, file)
      .then((image) =>
        ApiResponse.created(image, 'Them anh phong thanh cong.'),
      );
  }
}
