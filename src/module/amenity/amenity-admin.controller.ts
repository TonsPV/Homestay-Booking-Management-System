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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import {
  ApiResponse,
  type ApiResponsePayload,
  Roles,
  RolesGuard,
} from '../../common/http';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { AmenityService, type AdminAmenityResponse } from './amenity.service';
import { CreateAmenityDto } from './dto/create-amenity.dto';
import { AdminListAmenitiesQueryDto } from './dto/list-amenities-query.dto';
import { UpdateAmenityDto } from './dto/update-amenity.dto';

@Controller('v1/admin/amenities')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('ADMIN')
@ApiTags('Admin Amenities')
@ApiBearerAuth()
export class AmenityAdminController {
  constructor(private readonly amenityService: AmenityService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() body: CreateAmenityDto,
  ): Promise<ApiResponsePayload<AdminAmenityResponse>> {
    return this.amenityService
      .create(body)
      .then((amenity) =>
        ApiResponse.created(amenity, 'Tao tien nghi thanh cong.'),
      );
  }

  @Get()
  list(
    @Query() query: AdminListAmenitiesQueryDto,
  ): Promise<ApiResponsePayload<AdminAmenityResponse[]>> {
    return this.amenityService
      .listAdmin(query)
      .then((result) =>
        ApiResponse.ok(
          result.items,
          'Lay danh sach tien nghi quan ly thanh cong.',
          result.meta,
        ),
      );
  }

  @Get(':id')
  getById(
    @Param('id') id: string,
  ): Promise<ApiResponsePayload<AdminAmenityResponse>> {
    return this.amenityService
      .getAdmin(id)
      .then((amenity) =>
        ApiResponse.ok(amenity, 'Lay thong tin tien nghi thanh cong.'),
      );
  }

  @Patch(':id')
  update(
    @Param('id') id: string,
    @Body() body: UpdateAmenityDto,
  ): Promise<ApiResponsePayload<AdminAmenityResponse>> {
    return this.amenityService
      .update(id, body)
      .then((amenity) =>
        ApiResponse.ok(amenity, 'Cap nhat tien nghi thanh cong.'),
      );
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  softDelete(
    @Param('id') id: string,
  ): Promise<ApiResponsePayload<AdminAmenityResponse>> {
    return this.amenityService
      .softDelete(id)
      .then((amenity) => ApiResponse.ok(amenity, 'Xoa tien nghi thanh cong.'));
  }

  @Patch(':id/restore')
  restore(
    @Param('id') id: string,
  ): Promise<ApiResponsePayload<AdminAmenityResponse>> {
    return this.amenityService
      .restore(id)
      .then((amenity) =>
        ApiResponse.ok(amenity, 'Khoi phuc tien nghi thanh cong.'),
      );
  }
}
