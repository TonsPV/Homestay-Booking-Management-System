import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { AuthModule } from '../auth/auth.module';
import { Booking } from '../booking/schema/booking.entity';
import { Customer } from '../customer/schema/customer.entity';
import { User } from '../user/schema/user.entity';
import { ChatController } from './chat.controller';
import { ChatGateway } from './chat.gateway';
import { ChatRealtimeService } from './chat-realtime.service';
import { ChatConversation } from './schema/chat-conversation.entity';
import { ChatMessage } from './schema/chat-message.entity';
import { ChatReadState } from './schema/chat-read-state.entity';
import { ChatService } from './chat.service';
import { ChatEnabledGuard } from './guards/chat-enabled.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Booking,
      Customer,
      User,
      ChatConversation,
      ChatMessage,
      ChatReadState,
    ]),
    AuthModule,
  ],
  controllers: [ChatController],
  providers: [ChatService, ChatRealtimeService, ChatGateway, ChatEnabledGuard],
})
export class ChatModule {}
