import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth } from '@nestjs/swagger';

import {
  ApiResponse,
  RateLimit,
  RateLimitGuard,
  type ApiResponsePayload,
} from '../../common/http';
import {
  ApiCommonAuthErrors,
  ApiCommonMutationErrors,
  ApiFeatureUnavailableError,
  ApiOkEnvelope,
  ApiRateLimitError,
} from '../../openapi/api-response.decorators';
import type { AccessTokenPayload } from '../auth/auth.types';
import { CurrentAuth } from '../auth/decorators/current-auth.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ChatService, type ChatConversationListResult } from './chat.service';
import { CreateChatMessageDto } from './dto/create-chat-message.dto';
import { ListChatConversationsQueryDto } from './dto/list-chat-conversations-query.dto';
import { ListChatMessagesQueryDto } from './dto/list-chat-messages-query.dto';
import { MarkChatReadDto } from './dto/mark-chat-read.dto';
import {
  ChatBookingContextDto,
  ChatConversationDto,
  ChatMessageDto,
  ChatMessageListDto,
  ChatReadStateDto,
  ChatSummaryDto,
} from './dto/chat-response.dto';
import type {
  ChatBookingContextResponse,
  ChatMessageListResponse,
  ChatMessageResponse,
  ChatReadStateResponse,
  ChatSummaryResponse,
} from './chat.types';
import { ChatEnabledGuard } from './guards/chat-enabled.guard';

@Controller('v1/chat')
@UseGuards(ChatEnabledGuard, JwtAuthGuard, RateLimitGuard)
@ApiBearerAuth()
@ApiCommonAuthErrors()
@ApiFeatureUnavailableError()
@ApiRateLimitError()
@RateLimit({ limit: 120, windowMs: 60_000 })
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Get('conversations')
  @ApiOkEnvelope(ChatConversationDto, { isArray: true, paginated: true })
  async listConversations(
    @CurrentAuth() auth: AccessTokenPayload,
    @Query() query: ListChatConversationsQueryDto,
  ): Promise<ApiResponsePayload<ChatConversationDto[]>> {
    const result = await this.chatService.listConversations(auth, query);
    return this.listResponse(result);
  }

  @Get('summary')
  @ApiOkEnvelope(ChatSummaryDto)
  async getSummary(
    @CurrentAuth() auth: AccessTokenPayload,
  ): Promise<ApiResponsePayload<ChatSummaryResponse>> {
    return this.chatService
      .getSummary(auth)
      .then((summary) =>
        ApiResponse.ok(summary, 'Lay tong quan chat thanh cong.'),
      );
  }

  @Get('bookings/:bookingId')
  @ApiOkEnvelope(ChatBookingContextDto)
  async getBookingContext(
    @Param('bookingId') bookingId: string,
    @CurrentAuth() auth: AccessTokenPayload,
  ): Promise<ApiResponsePayload<ChatBookingContextResponse>> {
    return this.chatService
      .getBookingContext(bookingId, auth)
      .then((context) =>
        ApiResponse.ok(context, 'Lay chat booking thanh cong.'),
      );
  }

  @Get('bookings/:bookingId/messages')
  @ApiOkEnvelope(ChatMessageListDto)
  async listMessages(
    @Param('bookingId') bookingId: string,
    @CurrentAuth() auth: AccessTokenPayload,
    @Query() query: ListChatMessagesQueryDto,
  ): Promise<ApiResponsePayload<ChatMessageListResponse>> {
    return this.chatService
      .listMessages(bookingId, auth, query)
      .then((messages) =>
        ApiResponse.ok(messages, 'Lay lich su chat thanh cong.'),
      );
  }

  @Post('bookings/:bookingId/messages')
  @HttpCode(HttpStatus.OK)
  @RateLimit({ limit: 30, windowMs: 60_000 })
  @ApiOkEnvelope(ChatMessageDto)
  @ApiCommonMutationErrors()
  async sendMessage(
    @Param('bookingId') bookingId: string,
    @CurrentAuth() auth: AccessTokenPayload,
    @Body() body: CreateChatMessageDto,
  ): Promise<ApiResponsePayload<ChatMessageResponse>> {
    return this.chatService
      .sendMessage(bookingId, auth, body)
      .then((message) => ApiResponse.ok(message, 'Gui tin nhan thanh cong.'));
  }

  @Put('bookings/:bookingId/read')
  @ApiOkEnvelope(ChatReadStateDto)
  @ApiCommonMutationErrors()
  async markRead(
    @Param('bookingId') bookingId: string,
    @CurrentAuth() auth: AccessTokenPayload,
    @Body() body: MarkChatReadDto,
  ): Promise<ApiResponsePayload<ChatReadStateResponse>> {
    return this.chatService
      .markRead(bookingId, auth, body)
      .then((readState) =>
        ApiResponse.ok(readState, 'Cap nhat da doc thanh cong.'),
      );
  }

  private listResponse(
    result: ChatConversationListResult,
  ): ApiResponsePayload<ChatConversationDto[]> {
    return ApiResponse.ok(
      result.items,
      'Lay danh sach hoi thoai thanh cong.',
      result.meta,
    );
  }
}
