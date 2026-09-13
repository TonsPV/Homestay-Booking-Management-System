import type { ConfigService } from '@nestjs/config';
import type { DataSource, Repository } from 'typeorm';

import type { AccessTokenPayload } from '../../../../src/module/auth/auth.types';
import { Booking } from '../../../../src/module/booking/schema/booking.entity';
import { ChatRealtimeService } from '../../../../src/module/chat/chat-realtime.service';
import { ChatService } from '../../../../src/module/chat/chat.service';
import { ChatConversation } from '../../../../src/module/chat/schema/chat-conversation.entity';
import { ChatMessage } from '../../../../src/module/chat/schema/chat-message.entity';
import { ChatReadState } from '../../../../src/module/chat/schema/chat-read-state.entity';
import { Customer } from '../../../../src/module/customer/schema/customer.entity';
import { User } from '../../../../src/module/user/schema/user.entity';

describe('ChatService query paths', () => {
  let conversationRepo: { createQueryBuilder: jest.Mock; findOne: jest.Mock };
  let messageRepo: { createQueryBuilder: jest.Mock };
  let service: ChatService;

  beforeEach(() => {
    conversationRepo = {
      createQueryBuilder: jest.fn(),
      findOne: jest.fn(),
    };
    messageRepo = { createQueryBuilder: jest.fn() };
    service = new ChatService(
      { get: jest.fn().mockReturnValue(true) } as unknown as ConfigService,
      { manager: {} } as DataSource,
      {} as Repository<Booking>,
      conversationRepo as unknown as Repository<ChatConversation>,
      messageRepo as unknown as Repository<ChatMessage>,
      {} as Repository<ChatReadState>,
      {} as Repository<Customer>,
      {} as Repository<User>,
      {} as ChatRealtimeService,
    );
  });

  it('paginates and filters the inbox in SQL, then batches unread counts for the page', async () => {
    const baseQuery = createConversationQuery();
    const pageQuery = createConversationQuery({
      many: [conversationFixture('11'), conversationFixture('12')],
    });
    const countQuery = createConversationQuery({ count: 7 });
    baseQuery.clone
      .mockReturnValueOnce(pageQuery)
      .mockReturnValueOnce(countQuery);
    conversationRepo.createQueryBuilder.mockReturnValue(baseQuery);

    const unreadQuery = createUnreadQuery({
      rawMany: [
        { conversationId: '11', unreadCount: '2' },
        { conversationId: '12', unreadCount: '1' },
      ],
    });
    messageRepo.createQueryBuilder.mockReturnValue(unreadQuery);

    await expect(
      service.listConversations(staffAuth(), {
        page: 2,
        limit: 2,
        unread: true,
        needsReply: true,
      }),
    ).resolves.toMatchObject({
      items: [
        { id: '11', unreadCount: 2, needsReply: true },
        { id: '12', unreadCount: 1, needsReply: true },
      ],
      meta: { pagination: { page: 2, limit: 2, total: 7, totalPages: 4 } },
    });

    expect(baseQuery.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('EXISTS ('),
      {
        unreadActorType: 'user',
        unreadActorId: '2',
      },
    );
    expect(baseQuery.andWhere).toHaveBeenCalledWith(
      'conversation.lastMessageActorType = :needsReplyActorType',
      { needsReplyActorType: 'customer' },
    );
    expect(pageQuery.skip).toHaveBeenCalledWith(2);
    expect(pageQuery.take).toHaveBeenCalledWith(2);
    expect(countQuery.getCount).toHaveBeenCalledTimes(1);
    expect(pageQuery.getMany).toHaveBeenCalledTimes(1);
    expect(unreadQuery.where).toHaveBeenCalledWith(
      'message.conversationId IN (:...conversationIds)',
      { conversationIds: ['11', '12'] },
    );
    expect(unreadQuery.andWhere).toHaveBeenCalledWith(
      'message.senderActorType = :unreadSenderActorType',
      { unreadSenderActorType: 'customer' },
    );
    expect(unreadQuery.getRawMany).toHaveBeenCalledTimes(1);
  });

  it('aggregates the customer summary in SQL without loading every conversation', async () => {
    const unreadQuery = createUnreadQuery({
      rawOne: { unreadMessageCount: '4' },
    });
    messageRepo.createQueryBuilder.mockReturnValue(unreadQuery);

    await expect(service.getSummary(customerAuth())).resolves.toEqual({
      unreadMessageCount: 4,
      needsReplyConversationCount: 0,
    });

    expect(conversationRepo.createQueryBuilder).not.toHaveBeenCalled();
    expect(unreadQuery.innerJoin).toHaveBeenCalledWith(
      ChatConversation,
      'conversation',
      'conversation.id = message.conversationId',
    );
    expect(unreadQuery.where).toHaveBeenCalledWith(
      'message.senderActorType = :unreadSenderActorType',
      { unreadSenderActorType: 'user' },
    );
    expect(unreadQuery.andWhere).toHaveBeenCalledWith(
      'booking.customerId = :customerId',
      { customerId: '1' },
    );
    expect(unreadQuery.getRawOne).toHaveBeenCalledTimes(1);
  });

  it('uses a fixed pair of aggregate queries for the staff summary', async () => {
    const unreadQuery = createUnreadQuery({
      rawOne: { unreadMessageCount: '3' },
    });
    const needsReplyQuery = createConversationQuery({ count: 2 });
    messageRepo.createQueryBuilder.mockReturnValue(unreadQuery);
    conversationRepo.createQueryBuilder.mockReturnValue(needsReplyQuery);

    await expect(service.getSummary(staffAuth())).resolves.toEqual({
      unreadMessageCount: 3,
      needsReplyConversationCount: 2,
    });

    expect(needsReplyQuery.where).toHaveBeenCalledWith(
      'conversation.lastMessageActorType = :customerActorType',
      { customerActorType: 'customer' },
    );
    expect(needsReplyQuery.getCount).toHaveBeenCalledTimes(1);
    expect(unreadQuery.getRawOne).toHaveBeenCalledTimes(1);
  });
});

interface QueryResult {
  count?: number;
  many?: ChatConversation[];
}

interface UnreadQueryResult {
  rawMany?: Array<{ conversationId: string; unreadCount: string }>;
  rawOne?: { unreadMessageCount: string };
}

function createConversationQuery(result: QueryResult = {}) {
  const query = {
    withDeleted: jest.fn(),
    innerJoinAndSelect: jest.fn(),
    leftJoinAndSelect: jest.fn(),
    innerJoin: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    skip: jest.fn(),
    take: jest.fn(),
    clone: jest.fn(),
    getCount: jest.fn().mockResolvedValue(result.count ?? 0),
    getMany: jest.fn().mockResolvedValue(result.many ?? []),
  };

  for (const method of [
    query.withDeleted,
    query.innerJoinAndSelect,
    query.leftJoinAndSelect,
    query.innerJoin,
    query.where,
    query.andWhere,
    query.orderBy,
    query.addOrderBy,
    query.skip,
    query.take,
  ]) {
    method.mockReturnValue(query);
  }

  return query;
}

function createUnreadQuery(result: UnreadQueryResult = {}) {
  const query = {
    innerJoin: jest.fn(),
    leftJoin: jest.fn(),
    select: jest.fn(),
    addSelect: jest.fn(),
    where: jest.fn(),
    andWhere: jest.fn(),
    setParameters: jest.fn(),
    groupBy: jest.fn(),
    getRawMany: jest.fn().mockResolvedValue(result.rawMany ?? []),
    getRawOne: jest.fn().mockResolvedValue(result.rawOne),
  };

  for (const method of [
    query.innerJoin,
    query.leftJoin,
    query.select,
    query.addSelect,
    query.where,
    query.andWhere,
    query.setParameters,
    query.groupBy,
  ]) {
    method.mockReturnValue(query);
  }

  return query;
}

function conversationFixture(id: string): ChatConversation {
  const at = new Date('2026-09-13T10:00:00.000Z');

  return {
    id,
    bookingId: `booking-${id}`,
    booking: {
      id: `booking-${id}`,
      bookingCode: `BK-${id}`,
      status: 'CONFIRMED',
      checkInDate: '2026-10-01',
      checkOutDate: '2026-10-02',
      room: { roomNumber: '101', name: 'Deluxe 101' },
    } as Booking,
    lastSequence: 5,
    lastMessageContent: 'Can ho tro them',
    lastMessageActorType: 'customer',
    lastMessageActorId: '1',
    lastMessageAt: at,
    createdAt: at,
    updatedAt: at,
  };
}

function customerAuth(): AccessTokenPayload {
  return {
    sub: 'customer:1',
    actor_type: 'customer',
    customer_id: '1',
    token_version: 1,
    iat: 1,
    exp: 2,
  };
}

function staffAuth(): AccessTokenPayload {
  return {
    sub: 'user:2',
    actor_type: 'user',
    user_id: '2',
    role: 'STAFF',
    token_version: 1,
    iat: 1,
    exp: 2,
  };
}
