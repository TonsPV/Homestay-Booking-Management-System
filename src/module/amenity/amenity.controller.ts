import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';

import { ApiResponse, type ApiResponsePayload } from '../../common/http';
import { AmenityService, type AmenityResponse } from './amenity.service';
import { ListAmenitiesQueryDto } from './dto/list-amenities-query.dto';

@Controller('v1/amenities')
@ApiTags('Amenities')
export class AmenityController {
  constructor(private readonly amenityService: AmenityService) {}

  @Get()
  list(
    @Query() query: ListAmenitiesQueryDto,
  ): Promise<ApiResponsePayload<AmenityResponse[]>> {
    return this.amenityService
      .listPublic(query)
      .then((result) =>
        ApiResponse.ok(
          result.items,
          'Lay danh sach tien nghi thanh cong.',
          result.meta,
        ),
      );
  }

  @Get(':id')
  getById(
    @Param('id') id: string,
  ): Promise<ApiResponsePayload<AmenityResponse>> {
    return this.amenityService
      .getPublic(id)
      .then((amenity) =>
        ApiResponse.ok(amenity, 'Lay thong tin tien nghi thanh cong.'),
      );
  }
}
