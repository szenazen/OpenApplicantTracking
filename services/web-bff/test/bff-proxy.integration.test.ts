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
  const oldBffJobs = process.env.BFF_JOBS_TO_SLICE;
  const oldUserSlice = process.env.USER_SLICE_ENABLED;
  afterEach(() => {
    process.env.BFF_PIPELINES_TO_SLICE = oldBffPipelines;
    process.env.BFF_JOBS_TO_SLICE = oldBffJobs;
    process.env.USER_SLICE_ENABLED = oldUserSlice;
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

  it('rewrites GET /api/jobs to slice when BFF_JOBS_TO_SLICE', async () => {
    process.env.BFF_JOBS_TO_SLICE = '1';
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
      const r = await fetch(`${base}/api/jobs?limit=5`, {
        headers: { 'x-account-id': 'acc-job' },
      });
      expect(r.ok).toBe(true);
      const j = (await r.json()) as { path: string };
      expect(j.path).toBe('/api/slice/pipeline/accounts/acc-job/jobs?limit=5');
    } finally {
      await app.close();
      pipeline.close();
    }
  });

  it('returns 400 for GET /api/jobs without x-account-id when BFF_JOBS_TO_SLICE', async () => {
    process.env.BFF_JOBS_TO_SLICE = '1';
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
      const r = await fetch(`${base}/api/jobs`);
      expect(r.status).toBe(400);
      const j = (await r.json()) as { error?: string };
      expect(j.error).toContain('x-account-id');
    } finally {
      await app.close();
      pipeline.close();
    }
  });

  it('rewrites GET /api/jobs/:id to slice when BFF_JOBS_TO_SLICE', async () => {
    process.env.BFF_JOBS_TO_SLICE = '1';
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
    const base = `http://127.0.0.1:${bffAddr.port}`;

    try {
      const r = await fetch(`${base}/api/jobs/job-99?tab=summary`, {
        headers: { 'x-account-id': 'acc-job' },
      });
      expect(r.ok).toBe(true);
      const j = (await r.json()) as { path: string };
      expect(j.path).toBe('/api/slice/pipeline/accounts/acc-job/jobs/job-99?tab=summary');
    } finally {
      await app.close();
      pipeline.close();
    }
  });

  it('routes GET /api/users/me to user-service when USER_SLICE_ENABLED', async () => {
    process.env.USER_SLICE_ENABLED = '1';
    const user = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ upstream: 'user', path: req.url ?? '' }));
    });
    const uPort = await listen(user);

    const app = await buildApp({
      monolithUrl: 'http://127.0.0.1:9',
      accountServiceUrl: 'http://127.0.0.1:9',
      userServiceUrl: `http://127.0.0.1:${uPort}`,
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const bffAddr = app.server.address() as AddressInfo;
    const base = `http://127.0.0.1:${bffAddr.port}`;

    try {
      const r = await fetch(`${base}/api/users/me`);
      expect(r.ok).toBe(true);
      const j = (await r.json()) as { upstream: string; path: string };
      expect(j.upstream).toBe('user');
      expect(j.path).toBe('/api/users/me');
    } finally {
      await app.close();
      user.close();
    }
  });

  it('returns 503 for GET /api/users/me when USER_SLICE_ENABLED without USER_SERVICE_URL', async () => {
    process.env.USER_SLICE_ENABLED = '1';
    const app = await buildApp({
      monolithUrl: 'http://127.0.0.1:9',
      accountServiceUrl: 'http://127.0.0.1:9',
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const bffAddr = app.server.address() as AddressInfo;
    const base = `http://127.0.0.1:${bffAddr.port}`;

    try {
      const r = await fetch(`${base}/api/users/me`);
      expect(r.status).toBe(503);
      const j = (await r.json()) as { error?: string };
      expect(j.error).toContain('USER_SERVICE_URL');
    } finally {
      await app.close();
    }
  });
});
