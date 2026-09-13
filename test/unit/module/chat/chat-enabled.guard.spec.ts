import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { ChatEnabledGuard } from '../../../../src/module/chat/guards/chat-enabled.guard';

describe('ChatEnabledGuard', () => {
  it('allows the chat HTTP surface when the feature is enabled', () => {
    const guard = new ChatEnabledGuard(config(true));

    expect(guard.canActivate()).toBe(true);
  });

  it('returns 503 before authentication when the feature is disabled', () => {
    const guard = new ChatEnabledGuard(config(false));

    expect(() => guard.canActivate()).toThrow(ServiceUnavailableException);
  });
});

function config(chatEnabled: boolean): ConfigService {
  return {
    get: jest.fn().mockReturnValue(chatEnabled),
  } as unknown as ConfigService;
}
