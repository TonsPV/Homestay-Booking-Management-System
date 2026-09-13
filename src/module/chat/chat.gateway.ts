import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayDisconnect,
  type OnGatewayInit,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';

import { AccessTokenPrincipalService } from '../auth/access-token-principal.service';
import { AccessTokenService } from '../auth/access-token.service';
import type { AuthenticatedPrincipal } from '../auth/authenticated-principal';
import {
  actorRoom,
  ChatRealtimeService,
  staffRoom,
} from './chat-realtime.service';
import type { ChatActor } from './chat.types';

const ACTOR_CONNECTION_LIMIT = 5;
const REVALIDATE_INTERVAL_MS = 30_000;

interface ChatSocketSession {
  actor: ChatActor;
  expiresAtMs: number;
  token: string;
}

interface ChatSocketReservation {
  actorKey: string;
}

interface ChatSocketData {
  chatSession?: ChatSocketSession;
  chatReservation?: ChatSocketReservation;
}

// Socket.IO defaults Socket#data to any. Omitting it before replacing the
// field prevents untyped handshake state from escaping into authorization.
type ChatSocket = Omit<Socket, 'data'> & { data: ChatSocketData };

@WebSocketGateway({
  namespace: '/chat',
  path: '/socket.io',
  transports: ['websocket'],
  cors: {
    origin: true,
  },
})
export class ChatGateway implements OnGatewayInit, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(ChatGateway.name);
  private readonly actorSockets = new Map<string, Set<string>>();
  private readonly revalidationTimers = new Map<string, NodeJS.Timeout>();
  private readonly expirationTimers = new Map<string, NodeJS.Timeout>();
  private readonly pendingHandshakeCloseListeners = new Map<
    string,
    () => void
  >();

  constructor(
    private readonly configService: ConfigService,
    private readonly accessTokens: AccessTokenService,
    private readonly principals: AccessTokenPrincipalService,
    private readonly realtime: ChatRealtimeService,
  ) {}

  afterInit(server: Server): void {
    this.realtime.setServer(server);
    server.use((socket, next) => {
      const chatSocket = socket as unknown as ChatSocket;
      this.watchPendingHandshakeClose(chatSocket);

      void this.authorize(chatSocket)
        .then(() => {
          if (!this.isTransportOpen(chatSocket)) {
            this.releaseSocketReservation(chatSocket);
            this.removePendingHandshakeCloseWatcher(chatSocket);
            next(new Error('Chat connection is not authorized.'));
            return;
          }

          next();
        })
        .catch(() => {
          this.releaseSocketReservation(chatSocket);
          this.removePendingHandshakeCloseWatcher(chatSocket);
          next(new Error('Chat connection is not authorized.'));
        });
    });
  }

  handleConnection(socket: ChatSocket): void {
    const session = socket.data.chatSession;

    if (
      session === undefined ||
      socket.data.chatReservation?.actorKey !== actorKey(session.actor) ||
      !this.isTransportOpen(socket)
    ) {
      this.releaseSocketReservation(socket);
      this.removePendingHandshakeCloseWatcher(socket);
      socket.disconnect(true);
      return;
    }

    // The middleware already reserved this slot before calling next(), so a
    // concurrent handshake cannot bypass the per-actor connection cap.
    this.removePendingHandshakeCloseWatcher(socket);

    void socket.join(actorRoom(session.actor));
    if (session.actor.actorType === 'user') {
      void socket.join(staffRoom());
    }

    const revalidationTimer = setInterval(() => {
      void this.revalidate(socket);
    }, REVALIDATE_INTERVAL_MS);
    revalidationTimer.unref();
    this.revalidationTimers.set(socket.id, revalidationTimer);

    const expiryDelay = Math.max(0, session.expiresAtMs - Date.now() + 25);
    const expirationTimer = setTimeout(
      () => socket.disconnect(true),
      expiryDelay,
    );
    expirationTimer.unref();
    this.expirationTimers.set(socket.id, expirationTimer);
  }

  handleDisconnect(socket: ChatSocket): void {
    const revalidationTimer = this.revalidationTimers.get(socket.id);
    const expirationTimer = this.expirationTimers.get(socket.id);

    this.removePendingHandshakeCloseWatcher(socket);

    if (revalidationTimer !== undefined) {
      clearInterval(revalidationTimer);
      this.revalidationTimers.delete(socket.id);
    }

    if (expirationTimer !== undefined) {
      clearTimeout(expirationTimer);
      this.expirationTimers.delete(socket.id);
    }

    this.releaseSocketReservation(socket);
  }

  private async authorize(socket: ChatSocket): Promise<void> {
    if (this.configService.get<boolean>('CHAT_ENABLED') !== true) {
      throw new Error('Chat is disabled.');
    }

    const origin = socket.handshake.headers.origin;
    if (
      !this.isOriginAllowed(typeof origin === 'string' ? origin : undefined)
    ) {
      throw new Error('Chat origin is not allowed.');
    }

    const token = getHandshakeToken(socket);
    if (token === undefined) {
      throw new Error('Chat token is missing.');
    }

    const payload = this.accessTokens.verify(token);
    const principal = await this.principals.resolve(payload);
    const actor = toChatActor(principal);
    const key = actorKey(actor);
    const currentConnections = this.actorSockets.get(key);

    if (
      currentConnections !== undefined &&
      currentConnections.size >= ACTOR_CONNECTION_LIMIT
    ) {
      throw new Error('Chat connection limit exceeded.');
    }

    // Socket.IO does not invoke a namespace socket's disconnect lifecycle
    // when its Engine.IO transport closes during middleware execution.
    // Avoid creating a reservation after that close; the pending close
    // watcher covers the small race between this check and the reservation.
    if (!this.isTransportOpen(socket)) {
      throw new Error('Chat transport is closed.');
    }

    const sockets = currentConnections ?? new Set<string>();
    // Reserve the slot in middleware, before the connection lifecycle hook,
    // so simultaneous handshakes cannot both pass the five-connection cap.
    socket.data.chatSession = {
      actor,
      expiresAtMs: payload.exp * 1000,
      token,
    };
    socket.data.chatReservation = { actorKey: key };
    sockets.add(socket.id);
    this.actorSockets.set(key, sockets);
  }

  private watchPendingHandshakeClose(socket: ChatSocket): void {
    const onClose = () => {
      this.pendingHandshakeCloseListeners.delete(socket.id);
      this.releaseSocketReservation(socket);
    };

    this.pendingHandshakeCloseListeners.set(socket.id, onClose);
    socket.client.conn.once('close', onClose);
  }

  private removePendingHandshakeCloseWatcher(socket: ChatSocket): void {
    const onClose = this.pendingHandshakeCloseListeners.get(socket.id);

    if (onClose !== undefined) {
      socket.client.conn.off('close', onClose);
      this.pendingHandshakeCloseListeners.delete(socket.id);
    }
  }

  private releaseSocketReservation(socket: ChatSocket): void {
    const reservation = socket.data.chatReservation;

    if (reservation === undefined) {
      return;
    }

    const sockets = this.actorSockets.get(reservation.actorKey);
    sockets?.delete(socket.id);

    if (sockets?.size === 0) {
      this.actorSockets.delete(reservation.actorKey);
    }

    socket.data.chatReservation = undefined;
  }

  private isTransportOpen(socket: ChatSocket): boolean {
    return socket.client.conn.readyState === 'open';
  }

  private async revalidate(socket: ChatSocket): Promise<void> {
    const session = socket.data.chatSession;

    if (session === undefined) {
      socket.disconnect(true);
      return;
    }

    try {
      const payload = this.accessTokens.verify(session.token);
      const principal = await this.principals.resolve(payload);
      const actor = toChatActor(principal);

      if (actorKey(actor) !== actorKey(session.actor)) {
        throw new Error('Chat actor changed.');
      }
    } catch {
      this.logger.log({
        event: 'chat_socket_revalidation_failed',
        socketId: socket.id,
      });
      socket.disconnect(true);
    }
  }

  private isOriginAllowed(origin: string | undefined): boolean {
    const allowedOrigins =
      this.configService.get<string[]>('CORS_ORIGINS') ?? [];

    if (allowedOrigins.length > 0) {
      return origin !== undefined && allowedOrigins.includes(origin);
    }

    if (origin === undefined) {
      return true;
    }

    try {
      const url = new URL(origin);
      return (
        (url.protocol === 'http:' || url.protocol === 'https:') &&
        ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
      );
    } catch {
      return false;
    }
  }
}

function getHandshakeToken(socket: ChatSocket): string | undefined {
  const auth = socket.handshake.auth as unknown;

  if (auth === null || typeof auth !== 'object' || Array.isArray(auth)) {
    return undefined;
  }

  const token = (auth as Record<string, unknown>).token;
  if (typeof token !== 'string' || token.trim().length === 0) {
    return undefined;
  }

  return token.trim();
}

function toChatActor(principal: AuthenticatedPrincipal): ChatActor {
  if (principal.actorType === 'customer') {
    return { actorType: 'customer', actorId: principal.customerId };
  }

  if (principal.role !== 'STAFF' && principal.role !== 'ADMIN') {
    throw new Error('Chat role is not supported.');
  }

  return {
    actorType: 'user',
    actorId: principal.userId,
    role: principal.role,
  };
}

function actorKey(actor: Pick<ChatActor, 'actorType' | 'actorId'>): string {
  return `${actor.actorType}:${actor.actorId}`;
}
