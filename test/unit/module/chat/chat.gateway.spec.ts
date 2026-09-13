import { EventEmitter } from 'node:events';

import type { ConfigService } from '@nestjs/config';
import type { Server } from 'socket.io';

import { AccessTokenPrincipalService } from '../../../../src/module/auth/access-token-principal.service';
import { AccessTokenService } from '../../../../src/module/auth/access-token.service';
import type { AccessTokenPayload } from '../../../../src/module/auth/auth.types';
import type { AuthenticatedPrincipal } from '../../../../src/module/auth/authenticated-principal';
import { ChatGateway } from '../../../../src/module/chat/chat.gateway';
import { ChatRealtimeService } from '../../../../src/module/chat/chat-realtime.service';

type GatewaySocket = Parameters<ChatGateway['handleConnection']>[0];
type SocketMiddleware = (
  socket: GatewaySocket,
  next: (error?: Error) => void,
) => void;

class FakeEngineConnection extends EventEmitter {
  readyState: 'open' | 'closed' = 'open';

  close(): void {
    this.readyState = 'closed';
    this.emit('close');
  }
}

describe('ChatGateway', () => {
  it('releases a reservation when the transport closes before handleConnection', async () => {
    const { gateway, runMiddleware } = createGateway();

    for (let index = 1; index <= 5; index += 1) {
      const { socket, connection } = createSocket(`socket-${index}`);

      await expect(runMiddleware(socket)).resolves.toBeUndefined();
      connection.close();
    }

    const { socket: nextSocket } = createSocket('socket-6');

    await expect(runMiddleware(nextSocket)).resolves.toBeUndefined();
    expect(reservedSocketCount(gateway)).toBe(1);
  });

  it('does not reserve a slot after the transport closes during async authentication', async () => {
    let resolvePrincipal: (value: AuthenticatedPrincipal) => void;
    const principalPromise = new Promise<AuthenticatedPrincipal>((resolve) => {
      resolvePrincipal = resolve;
    });
    const { gateway, runMiddleware } = createGateway(
      jest.fn().mockReturnValue(principalPromise),
    );
    const { socket, connection } = createSocket('socket-1');

    const authorization = runMiddleware(socket);
    connection.close();
    resolvePrincipal!(customerPrincipal());

    await expect(authorization).resolves.toBeInstanceOf(Error);
    expect(reservedSocketCount(gateway)).toBe(0);
  });

  it('keeps its single reservation through connection and releases it on disconnect', async () => {
    const { gateway, runMiddleware } = createGateway();
    const { socket, connection } = createSocket('socket-1');

    await expect(runMiddleware(socket)).resolves.toBeUndefined();
    expect(connection.listenerCount('close')).toBe(1);
    expect(reservedSocketCount(gateway)).toBe(1);

    gateway.handleConnection(socket);

    expect(connection.listenerCount('close')).toBe(0);
    expect(reservedSocketCount(gateway)).toBe(1);

    gateway.handleDisconnect(socket);

    expect(reservedSocketCount(gateway)).toBe(0);
  });
});

function createGateway(
  resolve = jest.fn().mockResolvedValue(customerPrincipal()),
): {
  gateway: ChatGateway;
  runMiddleware: (socket: GatewaySocket) => Promise<Error | undefined>;
} {
  let middleware: SocketMiddleware | undefined;
  const gateway = new ChatGateway(
    {
      get: jest.fn((key: string) => (key === 'CHAT_ENABLED' ? true : [])),
    } as unknown as ConfigService,
    {
      verify: jest.fn().mockReturnValue(accessTokenPayload()),
    } as unknown as AccessTokenService,
    {
      resolve,
    } as unknown as AccessTokenPrincipalService,
    {
      setServer: jest.fn(),
    } as unknown as ChatRealtimeService,
  );
  const server = {
    use: jest.fn((registered: SocketMiddleware) => {
      middleware = registered;
    }),
  } as unknown as Server;

  gateway.afterInit(server);

  return {
    gateway,
    runMiddleware: (socket) =>
      new Promise((resolve) => {
        middleware!(socket, (error?: Error) => resolve(error));
      }),
  };
}

function createSocket(id: string): {
  socket: GatewaySocket;
  connection: FakeEngineConnection;
} {
  const connection = new FakeEngineConnection();

  return {
    socket: {
      id,
      data: {},
      handshake: {
        headers: { origin: 'http://localhost:5173' },
        auth: { token: 'access-token' },
      },
      client: { conn: connection },
      disconnect: jest.fn(),
      join: jest.fn().mockResolvedValue(undefined),
    } as unknown as GatewaySocket,
    connection,
  };
}

function reservedSocketCount(gateway: ChatGateway): number {
  const actorSockets = (
    gateway as unknown as { actorSockets: Map<string, Set<string>> }
  ).actorSockets;

  return actorSockets.get('customer:customer-1')?.size ?? 0;
}

function accessTokenPayload(): AccessTokenPayload {
  return {
    sub: 'customer:customer-1',
    actor_type: 'customer',
    customer_id: 'customer-1',
    token_version: 1,
    iat: 1,
    exp: Math.floor(Date.now() / 1000) + 60,
  };
}

function customerPrincipal(): AuthenticatedPrincipal {
  return {
    actorType: 'customer',
    sub: 'customer:customer-1',
    customerId: 'customer-1',
    tokenVersion: 1,
    iat: 1,
    exp: Math.floor(Date.now() / 1000) + 60,
  };
}
