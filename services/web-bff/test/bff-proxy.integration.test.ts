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

describe('Web BFF proxy (integration)', () => {
  const oldBffPipelines = process.env.BFF_PIPELINES_TO_SLICE;
  afterEach(() => {
    process.env.BFF_PIPELINES_TO_SLICE = oldBffPipelines;
  });

  it('routes invitations to account upstream and jobs to monolith', async () => {
    const monolith = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ upstream: 'monolith', path: req.url ?? '' }));
    });
    const account = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ upstream: 'account', path: req.url ?? '' }));
    });
    const mPort = await listen(monolith);
    const aPort = await listen(account);

    const app = await buildApp({
      monolithUrl: `http://127.0.0.1:${mPort}`,
      accountServiceUrl: `http://127.0.0.1:${aPort}`,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const bffAddr = app.server.address() as AddressInfo;
    const bffPort = bffAddr.port;
    const base = `http://127.0.0.1:${bffPort}`;

    try {
      const inv = await fetch(`${base}/api/invitations`);
      expect(inv.ok).toBe(true);
      const invJson = (await inv.json()) as { upstream: string };
      expect(invJson.upstream).toBe('account');

      const jobs = await fetch(`${base}/api/jobs`);
      expect(jobs.ok).toBe(true);
      const jobsJson = (await jobs.json()) as { upstream: string };
      expect(jobsJson.upstream).toBe('monolith');

      const health = await fetch(`${base}/bff-health`);
      expect(health.ok).toBe(true);
      expect(await health.text()).toContain('ok');
    } finally {
      await app.close();
      monolith.close();
      account.close();
    }
  });

  it('rewrites /api/pipelines to slice when BFF_PIPELINES_TO_SLICE', async () => {
    process.env.BFF_PIPELINES_TO_SLICE = '1';
    const pipeline = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ path: req.url ?? '' }));
    });
    const pPort = await listen(pipeline);

    const app = await buildApp({
      monolithUrl: 'http://127.0.0.1:9',
      accountServiceUrl: 'http://127.0.0.1:9',
      pipelineServiceUrl: `http://127.0.0.1:${pPort}`,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const bffAddr = app.server.address() as AddressInfo;
    const bffPort = bffAddr.port;
    const base = `http://127.0.0.1:${bffPort}`;

    try {
      const r = await fetch(`${base}/api/pipelines`, {
        headers: { 'x-account-id': 'acc-test' },
      });
      expect(r.ok).toBe(true);
      const j = (await r.json()) as { path: string };
      expect(j.path).toBe('/api/slice/pipeline/accounts/acc-test/pipelines');
    } finally {
      await app.close();
      pipeline.close();
    }
  });

  it('returns 400 for /api/pipelines without x-account-id when BFF_PIPELINES_TO_SLICE', async () => {
    process.env.BFF_PIPELINES_TO_SLICE = '1';
    const pipeline = createServer(() => {
      /* should not be called */
    });
    const pPort = await listen(pipeline);

    const app = await buildApp({
      monolithUrl: 'http://127.0.0.1:9',
      accountServiceUrl: 'http://127.0.0.1:9',
      pipelineServiceUrl: `http://127.0.0.1:${pPort}`,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const bffAddr = app.server.address() as AddressInfo;
    const base = `http://127.0.0.1:${bffAddr.port}`;

    try {
      const r = await fetch(`${base}/api/pipelines`);
      expect(r.status).toBe(400);
      const j = (await r.json()) as { error?: string };
      expect(j.error).toContain('x-account-id');
    } finally {
      await app.close();
      pipeline.close();
    }
  });
});
