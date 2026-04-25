import { buildAggregatedHealth } from '../src/aggregated-health';

describe('buildAggregatedHealth', () => {
  const orgFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = orgFetch;
  });

  it('merges monolith and account', async () => {
    globalThis.fetch = jest.fn().mockImplementation((url: string) => {
      if (String(url).includes('3001')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({ m: 1 }),
        } as never);
      }
      if (String(url).includes('3010')) {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => 'application/json' },
          json: async () => ({ a: 1 }),
        } as never);
      }
      return Promise.reject(new Error('unexpected ' + String(url)));
    });
    const r = await buildAggregatedHealth({
      monolithUrl: 'http://127.0.0.1:3001',
      accountServiceUrl: 'http://127.0.0.1:3010',
    });
    expect((r.monolith as { ok: boolean }).ok).toBe(true);
    expect((r.account as { ok: boolean }).ok).toBe(true);
  });
});
