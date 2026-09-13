import type {
  ChatBookingContextDto,
  ChatConversationDto,
  ChatMessageDto,
  ChatMessageListDto,
  ChatReadStateDto,
  ChatSummaryDto,
} from './dto/chat-response.dto';

export type ChatActor =
  | {
      actorType: 'customer';
      actorId: string;
    }
  | {
      actorType: 'user';
      actorId: string;
      role: 'STAFF' | 'ADMIN';
    };

export type ChatConversationResponse = ChatConversationDto;
export type ChatBookingContextResponse = ChatBookingContextDto;
export type ChatMessageResponse = ChatMessageDto;
export type ChatMessageListResponse = ChatMessageListDto;
export type ChatReadStateResponse = ChatReadStateDto;
export type ChatSummaryResponse = ChatSummaryDto;
