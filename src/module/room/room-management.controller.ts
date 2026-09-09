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
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { ApiResponse, type ApiResponsePayload } from '../../common/http';
import { ReqContext, type RequestContext } from '../../common/http';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import type { AccessTokenPayload } from '../auth/auth.types';
import { AuditActorType } from '../audit/domain/audit-log';
import {
  ApiCommonAuthErrors,
  ApiCommonMutationErrors,
  ApiCreatedEnvelope,
  ApiOkEnvelope,
} from '../../openapi/api-response.decorators';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { BlockRoomDatesDto } from './dto/block-room-dates.dto';
import { ListAvailableRoomsQueryDto } from './dto/list-available-rooms-query.dto';
import { ListManagementRoomsQueryDto } from './dto/list-management-rooms-query.dto';
import { RoomCalendarRangeQueryDto } from './dto/room-calendar-range-query.dto';
import {
  RoomCalendarEntryDto,
  UnblockRoomDatesDto,
} from './dto/room-calendar-response.dto';
import { ManagementRoomDto, RoomDto } from './dto/room-response.dto';
import {
  RoomAvailabilityService,
  type RoomCalendarEntryResponse,
  type UnblockRoomDatesResponse,
} from './room-availability.service';
import {
  RoomService,
  type ManagementRoomResponse,
  type RoomResponse,
} from './room.service';

@Controller('v1/management/rooms')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'STAFF')
@ApiTags('Management Rooms')
@ApiBearerAuth()
@ApiCommonAuthErrors()
export class RoomManagementController {
  constructor(
    private readonly roomService: RoomService,
    private readonly availabilityService: RoomAvailabilityService,
  ) {}

  @Get()
  @ApiOkEnvelope(ManagementRoomDto, { isArray: true, paginated: true })
  list(
    @Query() query: ListManagementRoomsQueryDto,
  ): Promise<ApiResponsePayload<ManagementRoomResponse[]>> {
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

  @Get('available')
  @ApiOperation({ summary: 'List bookable physical rooms for a stay range' })
  @ApiOkEnvelope(RoomDto, { isArray: true, paginated: true })
  available(
    @Query() query: ListAvailableRoomsQueryDto,
  ): Promise<ApiResponsePayload<RoomResponse[]>> {
    return this.roomService
      .listAvailable(query)
      .then((result) =>
        ApiResponse.ok(
          result.items,
          'Lay danh sach phong trong thanh cong.',
          result.meta,
        ),
      );
  }

  @Get(':roomId/calendar')
  @ApiOperation({ summary: 'List reserved and blocked room nights' })
  @ApiOkEnvelope(RoomCalendarEntryDto, { isArray: true })
  calendar(
    @Param('roomId') roomId: string,
    @Query() query: RoomCalendarRangeQueryDto,
  ): Promise<ApiResponsePayload<RoomCalendarEntryResponse[]>> {
    return this.availabilityService
      .list(roomId, query)
      .then((entries) =>
        ApiResponse.ok(entries, 'Lay lich phong quan ly thanh cong.'),
      );
  }

  @Post(':roomId/blocks')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Block a room date range' })
  @ApiCreatedEnvelope(RoomCalendarEntryDto, { isArray: true })
  @ApiCommonMutationErrors()
  block(
    @CurrentAuth() auth: AccessTokenPayload,
    @ReqContext() context: RequestContext,
    @Param('roomId') roomId: string,
    @Body() body: BlockRoomDatesDto,
  ): Promise<ApiResponsePayload<RoomCalendarEntryResponse[]>> {
    return this.availabilityService
      .block(roomId, body, {
        actorType: AuditActorType.USER,
        actorId: auth.user_id ?? null,
        requestId: context.requestId,
      })
      .then((entries) =>
        ApiResponse.created(entries, 'Khoa lich phong thanh cong.'),
      );
  }

  @Delete(':roomId/blocks')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remove blocked nights from a room date range' })
  @ApiOkEnvelope(UnblockRoomDatesDto)
  unblock(
    @CurrentAuth() auth: AccessTokenPayload,
    @ReqContext() context: RequestContext,
    @Param('roomId') roomId: string,
    @Query() query: RoomCalendarRangeQueryDto,
  ): Promise<ApiResponsePayload<UnblockRoomDatesResponse>> {
    return this.availabilityService
      .unblock(roomId, query, {
        actorType: AuditActorType.USER,
        actorId: auth.user_id ?? null,
        requestId: context.requestId,
      })
      .then((result) =>
        ApiResponse.ok(result, 'Mo khoa lich phong thanh cong.'),
      );
  }

  @Get(':id')
  @ApiOkEnvelope(RoomDto)
  getById(@Param('id') id: string): Promise<ApiResponsePayload<RoomResponse>> {
    return this.roomService
      .getManagement(id)
      .then((room) =>
        ApiResponse.ok(room, 'Lay thong tin phong quan ly thanh cong.'),
      );
  }
}
