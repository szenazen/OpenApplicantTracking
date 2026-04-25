import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import replyFrom from '@fastify/reply-from';

import { resolveUpstream } from './routing';

function buildDestUrl(req: FastifyRequest, monolith: string, account: string): string {
  const kind = resolveUpstream(req.method, req.url);
  if (kind === 'self') {
    throw new Error('health routes should be registered before the catch-all');
  }
  const base = kind === 'account' ? account : monolith;
  return new URL(req.url, `${base}/`).toString();
}

export type BffOptions = {
  monolithUrl: string;
  accountServiceUrl: string;
};

const DEFAULTS: BffOptions = {
  monolithUrl: process.env.MONOLITH_URL ?? 'http://127.0.0.1:3001',
  accountServiceUrl: process.env.ACCOUNT_SERVICE_URL ?? 'http://127.0.0.1:3010',
};

/**
 * Web BFF: single browser/API entry, routes to monolith (apps/api) or
 * account-service per {@link resolveUpstream}. apps/* remain the modular
 * monolith reference; this is the target edge in front of extracted services.
 */
export async function buildApp(opts: Partial<BffOptions> = {}): Promise<FastifyInstance> {
  const o = { ...DEFAULTS, ...opts };
  const monolith = o.monolithUrl.replace(/\/$/, '');
  const account = o.accountServiceUrl.replace(/\/$/, '');

  const app = Fastify({
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    bodyLimit: 25 * 1024 * 1024,
    trustProxy: true,
  });

  await app.register(replyFrom, {
    http2: false,
    globalAgent: true,
  });

  app.get('/gateway-health', async () => {
    return 'ok\n';
  });
  app.get('/bff-health', async () => {
    return 'ok\n';
  });

  app.all('/*', async (request, reply) => {
    const kind = resolveUpstream(request.method, request.url);
    if (kind === 'self') {
      return reply.status(404).send({ error: 'not found' });
    }
    const dest = buildDestUrl(request, monolith, account);
    return reply.from(dest, {
      rewriteRequestHeaders: (req, headers) => {
        const h: Record<string, string | string[] | number | undefined> = { ...headers };
        if (req.socket?.remoteAddress) {
          const prev = h['x-forwarded-for'];
          h['x-forwarded-for'] = prev
            ? `${String(Array.isArray(prev) ? prev[0] : prev)}, ${req.socket.remoteAddress}`
            : req.socket.remoteAddress;
        }
        h['x-forwarded-proto'] = (req as { protocol?: string }).protocol === 'https' ? 'https' : 'http';
        return h as { [k: string]: string | string[] | undefined };
      },
    });
  });

  return app;
}
