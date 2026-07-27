import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import {
  ApiResponse,
  type ApiResponsePayload,
  Roles,
  RolesGuard,
} from '../../common/http';
import { AccessTokenGuard } from '../auth/access-token.guard';
import { BlockRoomDatesDto } from './dto/block-room-dates.dto';
import { ListManagementRoomsQueryDto } from './dto/list-management-rooms-query.dto';
import { RoomCalendarRangeQueryDto } from './dto/room-calendar-range-query.dto';
import {
  RoomCalendarEntriesEnvelopeDto,
  UnblockRoomDatesEnvelopeDto,
} from './dto/room-calendar-response.dto';
import {
  RoomAvailabilityService,
  type RoomCalendarEntryResponse,
  type UnblockRoomDatesResponse,
} from './room-availability.service';
import { RoomService, type RoomResponse } from './room.service';

@Controller('v1/management/rooms')
@UseGuards(AccessTokenGuard, RolesGuard)
@Roles('ADMIN', 'STAFF')
@ApiTags('Management Rooms')
@ApiBearerAuth()
@ApiUnauthorizedResponse({ description: 'Authentication is required.' })
@ApiForbiddenResponse({ description: 'ADMIN or STAFF role is required.' })
export class RoomManagementController {
  constructor(
    private readonly roomService: RoomService,
    private readonly roomAvailabilityService: RoomAvailabilityService,
  ) {}

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

  @Get(':roomId/calendar')
  @ApiOperation({ summary: 'List reserved and blocked room nights' })
  @ApiOkResponse({ type: RoomCalendarEntriesEnvelopeDto })
  calendar(
    @Param('roomId') roomId: string,
    @Query() query: RoomCalendarRangeQueryDto,
  ): Promise<ApiResponsePayload<RoomCalendarEntryResponse[]>> {
    return this.roomAvailabilityService
      .list(roomId, query)
      .then((entries) =>
        ApiResponse.ok(entries, 'Lay lich phong quan ly thanh cong.'),
      );
  }

  @Post(':roomId/blocks')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Block a room date range' })
  @ApiCreatedResponse({ type: RoomCalendarEntriesEnvelopeDto })
  @ApiConflictResponse({
    description: 'At least one requested night is reserved or already blocked.',
  })
  block(
    @Param('roomId') roomId: string,
    @Body() body: BlockRoomDatesDto,
  ): Promise<ApiResponsePayload<RoomCalendarEntryResponse[]>> {
    return this.roomAvailabilityService
      .block(roomId, body)
      .then((entries) =>
        ApiResponse.created(entries, 'Khoa lich phong thanh cong.'),
      );
  }

  @Delete(':roomId/blocks')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove blocked nights from a room date range' })
  @ApiOkResponse({ type: UnblockRoomDatesEnvelopeDto })
  unblock(
    @Param('roomId') roomId: string,
    @Query() query: RoomCalendarRangeQueryDto,
  ): Promise<ApiResponsePayload<UnblockRoomDatesResponse>> {
    return this.roomAvailabilityService
      .unblock(roomId, query)
      .then((result) =>
        ApiResponse.ok(result, 'Mo khoa lich phong thanh cong.'),
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
