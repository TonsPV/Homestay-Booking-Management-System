import { ApiProperty } from '@nestjs/swagger';

export class ChatBookingSummaryDto {
  @ApiProperty({ example: '42' })
  id!: string;

  @ApiProperty({ example: 'BK-20260913-ABC123' })
  bookingCode!: string;

  @ApiProperty({ example: 'CONFIRMED' })
  status!: string;

  @ApiProperty({ example: '2026-09-20', format: 'date' })
  checkInDate!: string;

  @ApiProperty({ example: '2026-09-22', format: 'date' })
  checkOutDate!: string;

  @ApiProperty({ example: 'B201' })
  roomNumber!: string;

  @ApiProperty({ example: 'Deluxe B201' })
  roomName!: string;
}

export class ChatLastMessageDto {
  @ApiProperty({ example: 14 })
  sequence!: number;

  @ApiProperty({ example: 'Nhan vien se lien he lai trong it phut.' })
  content!: string;

  @ApiProperty({ enum: ['customer', 'user'] })
  senderActorType!: 'customer' | 'user';

  @ApiProperty({ example: '5' })
  senderActorId!: string;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

export class ChatMessageDto {
  @ApiProperty({ example: '100' })
  id!: string;

  @ApiProperty({ example: 14 })
  sequence!: number;

  @ApiProperty({ example: 'Nhan vien se lien he lai trong it phut.' })
  content!: string;

  @ApiProperty({ enum: ['customer', 'user'] })
  senderActorType!: 'customer' | 'user';

  @ApiProperty({ example: '5' })
  senderActorId!: string;

  @ApiProperty({ example: 'Le Thi B', nullable: true, type: String })
  senderName!: string | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: Date;
}

export class ChatConversationDto {
  @ApiProperty({ example: '16' })
  id!: string;

  @ApiProperty({ type: ChatBookingSummaryDto })
  booking!: ChatBookingSummaryDto;

  @ApiProperty({ example: 14 })
  lastSequence!: number;

  @ApiProperty({ type: ChatLastMessageDto, nullable: true })
  lastMessage!: ChatLastMessageDto | null;

  @ApiProperty({ example: 2, minimum: 0 })
  unreadCount!: number;

  @ApiProperty({ example: false })
  needsReply!: boolean;
}

export class ChatBookingContextDto {
  @ApiProperty({ type: ChatBookingSummaryDto })
  booking!: ChatBookingSummaryDto;

  @ApiProperty({ example: '16', nullable: true, type: String })
  conversationId!: string | null;

  @ApiProperty({ example: 14, minimum: 0 })
  lastSequence!: number;

  @ApiProperty({ example: 2, minimum: 0 })
  unreadCount!: number;
}

export class ChatMessageListDto {
  @ApiProperty({ example: '16', nullable: true, type: String })
  conversationId!: string | null;

  @ApiProperty({ example: 14, minimum: 0 })
  lastSequence!: number;

  @ApiProperty({ type: ChatMessageDto, isArray: true })
  messages!: ChatMessageDto[];

  @ApiProperty({ example: false })
  hasMoreBefore!: boolean;
}

export class ChatReadStateDto {
  @ApiProperty({ example: 14, minimum: 0 })
  lastReadSequence!: number;
}

export class ChatSummaryDto {
  @ApiProperty({ example: 3, minimum: 0 })
  unreadMessageCount!: number;

  @ApiProperty({
    example: 1,
    minimum: 0,
    description: 'Only non-zero for STAFF and ADMIN.',
  })
  needsReplyConversationCount!: number;
}
