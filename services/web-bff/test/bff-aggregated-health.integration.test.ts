import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import { buildApp } from '../src/build-app';

function listen(server: ReturnType<typeof createServer>): Promise<number> {
  return new Promise((resolve, reject) => {
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as AddressInfo;
      resolve(addr.port);
    });
    server.on('error', reject);
  });
}

function jsonReply(res: import('node:http').ServerResponse, body: unknown) {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

describe('GET /api/bff/aggregated-health (integration)', () => {
  it('merges backends and includes user slice when USER_SERVICE_URL is wired', async () => {
    const monolith = createServer((_, res) => jsonReply(res, { service: 'backup-api' }));
    const account = createServer((_, res) => jsonReply(res, { service: 'account-service' }));
    const user = createServer((_, res) => jsonReply(res, { service: 'user-service' }));

    const mPort = await listen(monolith);
    const aPort = await listen(account);
    const uPort = await listen(user);

    const app = await buildApp({
      monolithUrl: `http://127.0.0.1:${mPort}`,
      accountServiceUrl: `http://127.0.0.1:${aPort}`,
      userServiceUrl: `http://127.0.0.1:${uPort}`,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const bffPort = (app.server.address() as AddressInfo).port;
    const base = `http://127.0.0.1:${bffPort}`;

    try {
      const r = await fetch(`${base}/api/bff/aggregated-health`);
      expect(r.ok).toBe(true);
      const j = (await r.json()) as {
        bff: string;
        monolith?: { ok: boolean; body?: unknown };
        account?: { ok: boolean; body?: unknown };
        user?: { ok: boolean; body?: unknown };
      };
      expect(j.bff).toBe('ok');
      expect(j.monolith?.ok).toBe(true);
      expect((j.monolith?.body as { service?: string })?.service).toBe('backup-api');
      expect(j.account?.ok).toBe(true);
      expect((j.account?.body as { service?: string })?.service).toBe('account-service');
      expect(j.user?.ok).toBe(true);
      expect((j.user?.body as { service?: string })?.service).toBe('user-service');
    } finally {
      await app.close();
      monolith.close();
      account.close();
      user.close();
    }
  });
});
