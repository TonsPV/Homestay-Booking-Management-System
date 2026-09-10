import {
  Controller,
  Delete,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';

import { ApiResponse, type ApiResponsePayload } from '../../common/http';
import {
  ApiCommonAuthErrors,
  ApiOkEnvelope,
} from '../../openapi/api-response.decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { RoomImageDto } from './dto/room-response.dto';
import { RoomImageService } from './room-image.service';
import type { RoomImageResponse } from './room.service';

@Controller('v1/room-images')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
@ApiBearerAuth()
@ApiCommonAuthErrors()
export class RoomImageController {
  constructor(private readonly imageService: RoomImageService) {}

  @Delete(':imageId')
  @HttpCode(HttpStatus.OK)
  @ApiOkEnvelope(RoomImageDto)
  delete(
    @Param('imageId') imageId: string,
  ): Promise<ApiResponsePayload<RoomImageResponse>> {
    return this.imageService
      .delete(imageId)
      .then((image) => ApiResponse.ok(image, 'Xoa anh phong thanh cong.'));
  }

  @Patch(':imageId/set-cover')
  @ApiOkEnvelope(RoomImageDto)
  setCover(
    @Param('imageId') imageId: string,
  ): Promise<ApiResponsePayload<RoomImageResponse>> {
    return this.imageService
      .setCover(imageId)
      .then((image) => ApiResponse.ok(image, 'Dat anh bia thanh cong.'));
  }
}
