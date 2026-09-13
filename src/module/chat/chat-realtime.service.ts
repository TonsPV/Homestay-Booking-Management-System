import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';

import type { ChatActor } from './chat.types';

export type ChatChangedReason = 'message' | 'read';

/**
 * Socket.IO is an invalidation channel only. The client always reads message
 * data through REST, where booking authorization is enforced again.
 */
@Injectable()
export class ChatRealtimeService {
  private readonly logger = new Logger(ChatRealtimeService.name);
  private server: Server | undefined;

  setServer(server: Server): void {
    this.server = server;
  }

  publishMessageCreated(bookingId: string, customerId: string): void {
    this.publish(
      this.server
        ?.to(actorRoom({ actorType: 'customer', actorId: customerId }))
        .to(staffRoom()),
      bookingId,
      'message',
    );
  }

  publishReadChanged(actor: ChatActor, bookingId: string): void {
    this.publish(this.server?.to(actorRoom(actor)), bookingId, 'read');
  }

  private publish(
    target: ReturnType<Server['to']> | undefined,
    bookingId: string,
    reason: ChatChangedReason,
  ): void {
    if (target === undefined) {
      return;
    }

    try {
      target.emit('chat:changed', { bookingId, reason });
    } catch {
      // A successful database commit must not turn into a failed REST request
      // because a process-local realtime delivery attempt failed.
      this.logger.warn({
        event: 'chat_realtime_emit_failed',
        bookingId,
        reason,
      });
    }
  }
}

export function actorRoom(
  actor: Pick<ChatActor, 'actorType' | 'actorId'>,
): string {
  return `chat:actor:${actor.actorType}:${actor.actorId}`;
}

export function staffRoom(): string {
  return 'chat:staff';
}
