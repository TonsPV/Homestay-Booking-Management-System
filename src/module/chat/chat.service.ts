import {
  BadRequestException,
  ForbiddenException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, type EntityManager, type Repository } from 'typeorm';

import { getMysqlDuplicateKey } from '../../common/database/mysql-error';
import { AppHttpException } from '../../common/http/app-http-exception';
import {
  createPaginationMeta,
  type PaginationMeta,
} from '../../common/pagination/pagination.types';
import {
  optionalSearch,
  parsePagination,
  requireActorId,
  requireId,
  requireTrimmedString,
} from '../../common/validation';
import { ErrorCode } from '../../common/error-codes';
import type { AccessTokenPayload } from '../auth/auth.types';
import { Booking } from '../booking/schema/booking.entity';
import { Customer } from '../customer/schema/customer.entity';
import { User } from '../user/schema/user.entity';
import type { CreateChatMessageDto } from './dto/create-chat-message.dto';
import type { ListChatConversationsQueryDto } from './dto/list-chat-conversations-query.dto';
import type { ListChatMessagesQueryDto } from './dto/list-chat-messages-query.dto';
import type { MarkChatReadDto } from './dto/mark-chat-read.dto';
import { ChatRealtimeService } from './chat-realtime.service';
import { ChatConversation } from './schema/chat-conversation.entity';
import { ChatMessage } from './schema/chat-message.entity';
import { ChatReadState } from './schema/chat-read-state.entity';
import type {
  ChatActor,
  ChatBookingContextResponse,
  ChatConversationResponse,
  ChatMessageListResponse,
  ChatMessageResponse,
  ChatReadStateResponse,
  ChatSummaryResponse,
} from './chat.types';

const CHAT_CONTENT_MAX_LENGTH = 2000;
const CLIENT_MESSAGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

export interface ChatConversationListResult {
  items: ChatConversationResponse[];
  meta: PaginationMeta;
}

@Injectable()
export class ChatService {
  constructor(
    private readonly configService: ConfigService,
    private readonly dataSource: DataSource,
    @InjectRepository(Booking)
    private readonly bookingRepo: Repository<Booking>,
    @InjectRepository(ChatConversation)
    private readonly conversationRepo: Repository<ChatConversation>,
    @InjectRepository(ChatMessage)
    private readonly messageRepo: Repository<ChatMessage>,
    @InjectRepository(ChatReadState)
    private readonly readStateRepo: Repository<ChatReadState>,
    @InjectRepository(Customer)
    private readonly customerRepo: Repository<Customer>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    private readonly realtime: ChatRealtimeService,
  ) {}

  isEnabled(): boolean {
    return this.configService.get<boolean>('CHAT_ENABLED') === true;
  }

  async listConversations(
    auth: AccessTokenPayload,
    query: ListChatConversationsQueryDto,
  ): Promise<ChatConversationListResult> {
    this.assertEnabled();
    const actor = this.toActor(auth);
    const { page, limit, skip } = parsePagination(
      query as Record<string, unknown>,
    );
    const search = optionalSearch(query.search);
    const unread = parseOptionalBoolean(
      query.unread,
      'Bo loc chua doc khong hop le.',
    );
    const needsReply = parseOptionalBoolean(
      query.needsReply,
      'Bo loc can tra loi khong hop le.',
    );

    if (needsReply !== undefined && actor.actorType !== 'user') {
      throw new ForbiddenException('Ban khong co quyen dung bo loc nay.');
    }

    const filteredQuery = this.createAccessibleConversationQuery(actor, search);
    this.applyConversationFilters(filteredQuery, actor, unread, needsReply);
    const pageQuery = filteredQuery
      .clone()
      .orderBy('conversation.lastMessageAt', 'DESC')
      .addOrderBy('conversation.id', 'DESC')
      .skip(skip)
      .take(limit);
    const [total, conversations] = await Promise.all([
      filteredQuery.clone().getCount(),
      pageQuery.getMany(),
    ]);
    const unreadCounts = await this.getUnreadCounts(
      conversations.map((conversation) => conversation.id),
      actor,
    );

    return {
      items: conversations.map((conversation) =>
        this.toConversationResponse(
          conversation,
          actor,
          unreadCounts.get(conversation.id) ?? 0,
        ),
      ),
      meta: createPaginationMeta(page, limit, total),
    };
  }

  async getSummary(auth: AccessTokenPayload): Promise<ChatSummaryResponse> {
    this.assertEnabled();
    const actor = this.toActor(auth);
    const unreadMessageCount = this.getUnreadMessageCount(actor);
    const needsReplyConversationCount =
      actor.actorType === 'user'
        ? this.conversationRepo
            .createQueryBuilder('conversation')
            .withDeleted()
            .innerJoin('conversation.booking', 'booking')
            .where('conversation.lastMessageActorType = :customerActorType', {
              customerActorType: 'customer',
            })
            .getCount()
        : Promise.resolve(0);
    const [unreadCount, needsReplyCount] = await Promise.all([
      unreadMessageCount,
      needsReplyConversationCount,
    ]);

    return {
      unreadMessageCount: unreadCount,
      needsReplyConversationCount: needsReplyCount,
    };
  }

  async getBookingContext(
    bookingId: string,
    auth: AccessTokenPayload,
  ): Promise<ChatBookingContextResponse> {
    this.assertEnabled();
    const actor = this.toActor(auth);
    const booking = await this.findAccessibleBooking(bookingId, actor);
    const conversation = await this.conversationRepo.findOne({
      where: { bookingId: booking.id },
    });

    return {
      booking: this.toBookingSummary(booking),
      conversationId: conversation?.id ?? null,
      lastSequence: conversation?.lastSequence ?? 0,
      unreadCount:
        conversation === null
          ? 0
          : await this.getUnreadCount(conversation.id, actor),
    };
  }

  async listMessages(
    bookingId: string,
    auth: AccessTokenPayload,
    query: ListChatMessagesQueryDto,
  ): Promise<ChatMessageListResponse> {
    this.assertEnabled();
    const actor = this.toActor(auth);
    await this.findAccessibleBooking(bookingId, actor);
    const beforeSequence = parseOptionalSequence(
      query.beforeSequence,
      'beforeSequence khong hop le.',
      1,
    );
    const afterSequence = parseOptionalSequence(
      query.afterSequence,
      'afterSequence khong hop le.',
      0,
    );
    const limit =
      parseOptionalSequence(query.limit, 'Limit khong hop le.', 1, 100) ?? 50;

    if (beforeSequence !== undefined && afterSequence !== undefined) {
      throw new BadRequestException(
        'Chi duoc truyen beforeSequence hoac afterSequence.',
      );
    }

    const conversation = await this.conversationRepo.findOne({
      where: { bookingId },
    });

    if (conversation === null) {
      return {
        conversationId: null,
        lastSequence: 0,
        messages: [],
        hasMoreBefore: false,
      };
    }

    const messagesQuery = this.messageRepo
      .createQueryBuilder('message')
      .where('message.conversationId = :conversationId', {
        conversationId: conversation.id,
      });
    let reverseForPresentation = false;
    let hasMoreBefore = false;

    if (afterSequence !== undefined) {
      messagesQuery
        .andWhere('message.sequence > :afterSequence', { afterSequence })
        .orderBy('message.sequence', 'ASC')
        .take(limit);
    } else {
      if (beforeSequence !== undefined) {
        messagesQuery.andWhere('message.sequence < :beforeSequence', {
          beforeSequence,
        });
      }

      messagesQuery.orderBy('message.sequence', 'DESC').take(limit + 1);
      reverseForPresentation = true;
    }

    const fetched = await messagesQuery.getMany();
    if (reverseForPresentation && fetched.length > limit) {
      fetched.pop();
      hasMoreBefore = true;
    }

    const messages = reverseForPresentation ? fetched.reverse() : fetched;

    return {
      conversationId: conversation.id,
      lastSequence: conversation.lastSequence,
      messages: await this.toMessageResponses(messages),
      hasMoreBefore,
    };
  }

  async sendMessage(
    bookingId: string,
    auth: AccessTokenPayload,
    body: CreateChatMessageDto,
  ): Promise<ChatMessageResponse> {
    this.assertEnabled();
    const actor = this.toActor(auth);
    const content = requireTrimmedString(
      body.content,
      'Noi dung tin nhan khong hop le.',
      CHAT_CONTENT_MAX_LENGTH,
    );
    const clientMessageId = requireTrimmedString(
      body.clientMessageId,
      'clientMessageId khong hop le.',
      100,
    );

    if (!CLIENT_MESSAGE_ID_PATTERN.test(clientMessageId)) {
      throw new BadRequestException('clientMessageId khong hop le.');
    }

    const booking = await this.findAccessibleBooking(bookingId, actor);
    let result: PersistedChatMessage | undefined;

    // The unique booking key resolves the only creation race. Retrying the
    // complete transaction is required because MySQL rolls it back after the
    // losing insert attempt.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        result = await this.dataSource.transaction((manager) =>
          this.persistMessage(
            manager,
            booking,
            actor,
            content,
            clientMessageId,
          ),
        );
        break;
      } catch (error) {
        if (
          attempt === 0 &&
          getMysqlDuplicateKey(error) === 'uq_chat_conversations_booking'
        ) {
          continue;
        }

        throw error;
      }
    }

    if (result === undefined) {
      throw new ServiceUnavailableException('Khong the luu tin nhan.');
    }

    const response = (await this.toMessageResponses([result.message]))[0];
    if (response === undefined) {
      throw new ServiceUnavailableException('Khong the tai tin nhan da luu.');
    }

    if (result.created) {
      this.realtime.publishMessageCreated(booking.id, booking.customerId);
    }

    return response;
  }

  async markRead(
    bookingId: string,
    auth: AccessTokenPayload,
    body: MarkChatReadDto,
  ): Promise<ChatReadStateResponse> {
    this.assertEnabled();
    const actor = this.toActor(auth);
    const requestedSequence = parseRequiredSequence(
      body.lastReadSequence,
      'lastReadSequence khong hop le.',
      0,
    );
    const booking = await this.findAccessibleBooking(bookingId, actor);
    const result = await this.dataSource.transaction((manager) =>
      this.persistReadState(manager, booking, actor, requestedSequence),
    );

    if (result.changed) {
      this.realtime.publishReadChanged(actor, booking.id);
    }

    return { lastReadSequence: result.lastReadSequence };
  }

  private assertEnabled(): void {
    if (!this.isEnabled()) {
      throw new ServiceUnavailableException('Tinh nang chat chua duoc bat.');
    }
  }

  private toActor(auth: AccessTokenPayload): ChatActor {
    if (auth.actor_type === 'customer') {
      return {
        actorType: 'customer',
        actorId: requireActorId(auth.customer_id),
      };
    }

    if (
      auth.actor_type === 'user' &&
      (auth.role === 'STAFF' || auth.role === 'ADMIN')
    ) {
      return {
        actorType: 'user',
        actorId: requireActorId(auth.user_id),
        role: auth.role,
      };
    }

    throw new UnauthorizedException('Access token is invalid.');
  }

  private async findAccessibleBooking(
    bookingId: string,
    actor: ChatActor,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<Booking> {
    const id = requireId(bookingId, 'Booking');
    const query = manager
      .getRepository(Booking)
      .createQueryBuilder('booking')
      .withDeleted()
      .leftJoinAndSelect('booking.room', 'room')
      .where('booking.id = :id', { id });

    if (actor.actorType === 'customer') {
      query.andWhere('booking.customerId = :customerId', {
        customerId: actor.actorId,
      });
    }

    const booking = await query.getOne();
    if (booking === null) {
      // This deliberately does not distinguish another customer's booking.
      throw new NotFoundException('Khong tim thay booking.');
    }

    return booking;
  }

  private createAccessibleConversationQuery(actor: ChatActor, search?: string) {
    const query = this.conversationRepo
      .createQueryBuilder('conversation')
      .withDeleted()
      .innerJoinAndSelect('conversation.booking', 'booking')
      .leftJoinAndSelect('booking.room', 'room')
      .where('conversation.lastSequence > 0');

    if (actor.actorType === 'customer') {
      query.andWhere('booking.customerId = :customerId', {
        customerId: actor.actorId,
      });
    }

    if (search !== undefined) {
      query.andWhere('LOWER(booking.bookingCode) LIKE :search', {
        search: `%${search.toLowerCase()}%`,
      });
    }

    return query;
  }

  private applyConversationFilters(
    query: ReturnType<Repository<ChatConversation>['createQueryBuilder']>,
    actor: ChatActor,
    unread: boolean | undefined,
    needsReply: boolean | undefined,
  ): void {
    if (unread !== undefined) {
      const unreadMessageExists =
        this.unreadMessageExistsExpression('conversation');
      query.andWhere(
        unread ? unreadMessageExists : `NOT ${unreadMessageExists}`,
        this.unreadActorParameters(actor),
      );
    }

    if (needsReply !== undefined) {
      if (needsReply) {
        query.andWhere(
          'conversation.lastMessageActorType = :needsReplyActorType',
          { needsReplyActorType: 'customer' },
        );
      } else {
        query.andWhere(
          '(conversation.lastMessageActorType IS NULL OR conversation.lastMessageActorType != :needsReplyActorType)',
          { needsReplyActorType: 'customer' },
        );
      }
    }
  }

  private toConversationResponse(
    conversation: ChatConversation,
    actor: ChatActor,
    unreadCount: number,
  ): ChatConversationResponse {
    const booking = conversation.booking;
    const hasLastMessage =
      conversation.lastMessageContent !== null &&
      conversation.lastMessageActorType !== null &&
      conversation.lastMessageActorId !== null &&
      conversation.lastMessageAt !== null;

    return {
      id: conversation.id,
      booking: this.toBookingSummary(booking),
      lastSequence: conversation.lastSequence,
      lastMessage: hasLastMessage
        ? {
            sequence: conversation.lastSequence,
            content: conversation.lastMessageContent!,
            senderActorType: conversation.lastMessageActorType!,
            senderActorId: conversation.lastMessageActorId!,
            createdAt: conversation.lastMessageAt!,
          }
        : null,
      unreadCount,
      needsReply:
        actor.actorType === 'user' &&
        conversation.lastMessageActorType === 'customer',
    };
  }

  private toBookingSummary(booking: Booking): {
    id: string;
    bookingCode: string;
    status: string;
    checkInDate: string;
    checkOutDate: string;
    roomNumber: string;
    roomName: string;
  } {
    return {
      id: booking.id,
      bookingCode: booking.bookingCode,
      status: booking.status,
      checkInDate: booking.checkInDate,
      checkOutDate: booking.checkOutDate,
      roomNumber: booking.room?.roomNumber ?? '',
      roomName: booking.room?.name ?? 'Phong khong con ton tai',
    };
  }

  private async getUnreadCount(
    conversationId: string,
    actor: ChatActor,
  ): Promise<number> {
    return (
      (await this.getUnreadCounts([conversationId], actor)).get(
        conversationId,
      ) ?? 0
    );
  }

  private async getUnreadCounts(
    conversationIds: string[],
    actor: ChatActor,
  ): Promise<Map<string, number>> {
    if (conversationIds.length === 0) {
      return new Map();
    }

    const rows = await this.messageRepo
      .createQueryBuilder('message')
      .leftJoin(
        ChatReadState,
        'readState',
        [
          'readState.conversationId = message.conversationId',
          'readState.actorType = :unreadActorType',
          'readState.actorId = :unreadActorId',
        ].join(' AND '),
      )
      .select('message.conversationId', 'conversationId')
      .addSelect('COUNT(message.id)', 'unreadCount')
      .where('message.conversationId IN (:...conversationIds)', {
        conversationIds,
      })
      .andWhere('message.senderActorType = :unreadSenderActorType', {
        unreadSenderActorType: this.unreadSenderActorType(actor),
      })
      .andWhere('message.sequence > COALESCE(readState.lastReadSequence, 0)')
      .setParameters(this.unreadActorParameters(actor))
      .groupBy('message.conversationId')
      .getRawMany<ChatUnreadCountRow>();

    return new Map(
      rows.map((row) => [
        String(row.conversationId),
        toNonNegativeCount(row.unreadCount),
      ]),
    );
  }

  private async getUnreadMessageCount(actor: ChatActor): Promise<number> {
    const query = this.messageRepo
      .createQueryBuilder('message')
      .innerJoin(
        ChatConversation,
        'conversation',
        'conversation.id = message.conversationId',
      )
      .innerJoin(Booking, 'booking', 'booking.id = conversation.bookingId')
      .leftJoin(
        ChatReadState,
        'readState',
        [
          'readState.conversationId = message.conversationId',
          'readState.actorType = :unreadActorType',
          'readState.actorId = :unreadActorId',
        ].join(' AND '),
      )
      .select('COUNT(message.id)', 'unreadMessageCount')
      .where('message.senderActorType = :unreadSenderActorType', {
        unreadSenderActorType: this.unreadSenderActorType(actor),
      })
      .andWhere('message.sequence > COALESCE(readState.lastReadSequence, 0)')
      .setParameters(this.unreadActorParameters(actor));

    if (actor.actorType === 'customer') {
      query.andWhere('booking.customerId = :customerId', {
        customerId: actor.actorId,
      });
    }

    const row = await query.getRawOne<ChatUnreadMessageCountRow>();
    return toNonNegativeCount(row?.unreadMessageCount);
  }

  private unreadMessageExistsExpression(conversationAlias: string): string {
    return `EXISTS (
      SELECT 1
      FROM chat_messages unread_filter_message
      LEFT JOIN chat_read_states unread_filter_state
        ON unread_filter_state.conversation_id = unread_filter_message.conversation_id
        AND unread_filter_state.actor_type = :unreadActorType
        AND unread_filter_state.actor_id = :unreadActorId
      WHERE unread_filter_message.conversation_id = ${conversationAlias}.id
        AND unread_filter_message.sender_actor_type = :unreadSenderActorType
        AND unread_filter_message.sequence > COALESCE(unread_filter_state.last_read_sequence, 0)
    )`;
  }

  private unreadActorParameters(actor: ChatActor): {
    unreadActorType: ChatActor['actorType'];
    unreadActorId: string;
  } {
    return {
      unreadActorType: actor.actorType,
      unreadActorId: actor.actorId,
    };
  }

  private unreadSenderActorType(actor: ChatActor): 'customer' | 'user' {
    return actor.actorType === 'customer' ? 'user' : 'customer';
  }

  private async toMessageResponses(
    messages: ChatMessage[],
  ): Promise<ChatMessageResponse[]> {
    const customerIds = [
      ...new Set(
        messages
          .filter((message) => message.senderActorType === 'customer')
          .map((message) => message.senderActorId),
      ),
    ];
    const userIds = [
      ...new Set(
        messages
          .filter((message) => message.senderActorType === 'user')
          .map((message) => message.senderActorId),
      ),
    ];
    const [customers, users] = await Promise.all([
      customerIds.length === 0
        ? Promise.resolve([])
        : this.customerRepo.find({
            where: { id: In(customerIds) },
            withDeleted: true,
          }),
      userIds.length === 0
        ? Promise.resolve([])
        : this.userRepo.find({
            where: { id: In(userIds) },
            withDeleted: true,
          }),
    ]);
    const customerNames = new Map(
      customers.map((customer) => [customer.id, customer.fullName]),
    );
    const userNames = new Map(users.map((user) => [user.id, user.fullName]));

    return messages.map((message) => ({
      id: message.id,
      sequence: message.sequence,
      content: message.content,
      senderActorType: message.senderActorType,
      senderActorId: message.senderActorId,
      senderName:
        message.senderActorType === 'customer'
          ? (customerNames.get(message.senderActorId) ?? 'Khach hang')
          : (userNames.get(message.senderActorId) ?? 'Nhan vien'),
      createdAt: message.createdAt,
    }));
  }

  private async persistMessage(
    manager: EntityManager,
    booking: Booking,
    actor: ChatActor,
    content: string,
    clientMessageId: string,
  ): Promise<PersistedChatMessage> {
    const conversationRepo = manager.getRepository(ChatConversation);
    let conversation = await this.lockConversation(manager, booking.id);

    if (conversation === null) {
      await conversationRepo.save(
        conversationRepo.create({
          bookingId: booking.id,
          lastSequence: 0,
          lastMessageContent: null,
          lastMessageActorType: null,
          lastMessageActorId: null,
          lastMessageAt: null,
        }),
      );
      conversation = await this.lockConversation(manager, booking.id);
    }

    if (conversation === null) {
      throw new ServiceUnavailableException('Khong the tao hoi thoai.');
    }

    const messageRepo = manager.getRepository(ChatMessage);
    const existing = await messageRepo.findOne({
      where: {
        conversationId: conversation.id,
        senderActorType: actor.actorType,
        senderActorId: actor.actorId,
        clientMessageId,
      },
    });

    if (existing !== null) {
      if (existing.content !== content) {
        throw new AppHttpException(
          HttpStatus.CONFLICT,
          ErrorCode.CHAT_MESSAGE_IDEMPOTENCY_CONFLICT,
          'clientMessageId da duoc dung voi noi dung khac.',
        );
      }

      return { message: existing, created: false };
    }

    const createdAt = new Date();
    const message = await messageRepo.save(
      messageRepo.create({
        conversationId: conversation.id,
        sequence: conversation.lastSequence + 1,
        senderActorType: actor.actorType,
        senderActorId: actor.actorId,
        content,
        clientMessageId,
        createdAt,
      }),
    );
    conversation.lastSequence = message.sequence;
    conversation.lastMessageContent = message.content;
    conversation.lastMessageActorType = message.senderActorType;
    conversation.lastMessageActorId = message.senderActorId;
    conversation.lastMessageAt = message.createdAt;
    await conversationRepo.save(conversation);

    return { message, created: true };
  }

  private async persistReadState(
    manager: EntityManager,
    booking: Booking,
    actor: ChatActor,
    requestedSequence: number,
  ): Promise<PersistedReadState> {
    const conversation = await this.lockConversation(manager, booking.id);

    if (conversation === null) {
      if (requestedSequence > 0) {
        throw new BadRequestException('lastReadSequence vuot qua tin hien co.');
      }

      return { lastReadSequence: 0, changed: false };
    }

    if (requestedSequence > conversation.lastSequence) {
      throw new BadRequestException('lastReadSequence vuot qua tin hien co.');
    }

    const readStateRepo = manager.getRepository(ChatReadState);
    const current = await readStateRepo.findOne({
      where: {
        conversationId: conversation.id,
        actorType: actor.actorType,
        actorId: actor.actorId,
      },
    });
    const currentSequence = current?.lastReadSequence ?? 0;

    if (requestedSequence <= currentSequence) {
      return { lastReadSequence: currentSequence, changed: false };
    }

    await readStateRepo.save(
      current === null
        ? readStateRepo.create({
            conversationId: conversation.id,
            actorType: actor.actorType,
            actorId: actor.actorId,
            lastReadSequence: requestedSequence,
          })
        : {
            ...current,
            lastReadSequence: requestedSequence,
          },
    );

    return { lastReadSequence: requestedSequence, changed: true };
  }

  private lockConversation(
    manager: EntityManager,
    bookingId: string,
  ): Promise<ChatConversation | null> {
    return manager
      .getRepository(ChatConversation)
      .createQueryBuilder('conversation')
      .setLock('pessimistic_write')
      .where('conversation.bookingId = :bookingId', { bookingId })
      .getOne();
  }
}

interface PersistedChatMessage {
  message: ChatMessage;
  created: boolean;
}

interface PersistedReadState {
  lastReadSequence: number;
  changed: boolean;
}

interface ChatUnreadCountRow {
  conversationId: string | number;
  unreadCount: string | number | null;
}

interface ChatUnreadMessageCountRow {
  unreadMessageCount: string | number | null;
}

function toNonNegativeCount(value: string | number | null | undefined): number {
  const count = Number(value ?? 0);

  return Number.isSafeInteger(count) && count > 0 ? count : 0;
}

function parseOptionalBoolean(
  value: unknown,
  message: string,
): boolean | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (value === true || value === 'true' || value === '1') {
    return true;
  }

  if (value === false || value === 'false' || value === '0') {
    return false;
  }

  throw new BadRequestException(message);
}

function parseOptionalSequence(
  value: unknown,
  message: string,
  minimum: number,
  maximum = 2_147_483_647,
): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  return parseRequiredSequence(value, message, minimum, maximum);
}

function parseRequiredSequence(
  value: unknown,
  message: string,
  minimum: number,
  maximum = 2_147_483_647,
): number {
  const parsed = typeof value === 'number' ? value : Number(value);

  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new BadRequestException(message);
  }

  return parsed;
}
