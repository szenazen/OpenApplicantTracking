import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import replyFrom from '@fastify/reply-from';

import { buildAggregatedHealth } from './aggregated-health';
import { resolveUpstream, type UpstreamKind } from './routing';

function trimBase(s: string): string {
  return s.replace(/\/$/, '');
}

function buildDestUrl(
  req: FastifyRequest,
  bases: {
    monolith: string;
    account: string;
    pipeline?: string;
    auth?: string;
  },
  kind: Exclude<UpstreamKind, 'self'>,
): string {
  if (kind === 'pipeline') {
    if (!bases.pipeline) {
      throw new Error('pipeline upstream not configured');
    }
    return new URL(req.url, `${trimBase(bases.pipeline)}/`).toString();
  }
  if (kind === 'auth') {
    if (!bases.auth) {
      throw new Error('auth upstream not configured');
    }
    return new URL(req.url, `${trimBase(bases.auth)}/`).toString();
  }
  const base = kind === 'account' ? bases.account : bases.monolith;
  return new URL(req.url, `${trimBase(base)}/`).toString();
}

export type BffOptions = {
  monolithUrl: string;
  accountServiceUrl: string;
  /** Optional — when slice env flags route to these hosts */
  pipelineServiceUrl?: string;
  authServiceUrl?: string;
  /** Optional — only used by /api/bff/aggregated-health */
  kafkaPingUrl?: string;
};

const DEFAULTS: BffOptions = {
  monolithUrl: process.env.MONOLITH_URL ?? 'http://127.0.0.1:3001',
  accountServiceUrl: process.env.ACCOUNT_SERVICE_URL ?? 'http://127.0.0.1:3010',
  pipelineServiceUrl: process.env.PIPELINE_SERVICE_URL,
  authServiceUrl: process.env.AUTH_SERVICE_URL,
  kafkaPingUrl: process.env.KAFKA_PING_URL,
};

/**
 * Web BFF: single browser/API entry, routes to monolith (apps/api) or
 * extracted services per {@link resolveUpstream}. apps/* stay the modular
 * monolith reference; run the monolith directly (port 3001) for monolith mode.
 */
export async function buildApp(opts: Partial<BffOptions> = {}): Promise<FastifyInstance> {
  const o = { ...DEFAULTS, ...opts };
  const monolith = trimBase(o.monolithUrl);
  const account = trimBase(o.accountServiceUrl);
  const pipeline = o.pipelineServiceUrl ? trimBase(o.pipelineServiceUrl) : undefined;
  const auth = o.authServiceUrl ? trimBase(o.authServiceUrl) : undefined;

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

  app.get('/api/bff/aggregated-health', async () => {
    return buildAggregatedHealth({
      monolithUrl: monolith,
      accountServiceUrl: account,
      pipelineServiceUrl: pipeline,
      authServiceUrl: auth,
      kafkaPingUrl: o.kafkaPingUrl,
    });
  });

  app.all('/*', async (request, reply) => {
    const kind = resolveUpstream(request.method, request.url);
    if (kind === 'self') {
      return reply.status(404).send({ error: 'not found' });
    }
    if (kind === 'pipeline' && !pipeline) {
      return reply.status(503).send({ error: 'Pipeline slice not configured (set PIPELINE_SERVICE_URL)' });
    }
    if (kind === 'auth' && !auth) {
      return reply.status(503).send({ error: 'Auth slice not configured (set AUTH_SERVICE_URL)' });
    }
    const dest = buildDestUrl(
      request,
      { monolith, account, pipeline, auth },
      kind,
    );
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
