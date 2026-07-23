import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';

import {
  ApiResponse,
  type ApiResponsePayload,
  Roles,
  RolesGuard,
} from '../../common/http';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { RoomImageService } from './room-image.service';
import type { RoomImageResponse } from './room.service';

@Controller('v1/room-images')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('ADMIN')
export class RoomImageController {
  constructor(private readonly roomImageService: RoomImageService) {}

  @Delete(':imageId')
  @HttpCode(HttpStatus.OK)
  delete(
    @Param('imageId') imageId: string,
  ): Promise<ApiResponsePayload<RoomImageResponse>> {
    return this.roomImageService
      .delete(imageId)
      .then((image) => ApiResponse.ok(image, 'Xoa anh phong thanh cong.'));
  }

  @Patch(':imageId/set-cover')
  setCover(
    @Param('imageId') imageId: string,
  ): Promise<ApiResponsePayload<RoomImageResponse>> {
    return this.roomImageService
      .setCover(imageId)
      .then((image) => ApiResponse.ok(image, 'Dat anh bia thanh cong.'));
  }
}
