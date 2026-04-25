import { resolveUpstream } from '../src/routing';

describe('resolveUpstream', () => {
  const oldPipeline = process.env.PIPELINE_SLICE_ENABLED;
  const oldAuth = process.env.AUTH_SLICE_ENABLED;
  const oldBffPipelines = process.env.BFF_PIPELINES_TO_SLICE;

  afterEach(() => {
    process.env.PIPELINE_SLICE_ENABLED = oldPipeline;
    process.env.AUTH_SLICE_ENABLED = oldAuth;
    process.env.BFF_PIPELINES_TO_SLICE = oldBffPipelines;
  });

  it('health is self', () => {
    expect(resolveUpstream('GET', '/gateway-health')).toBe('self');
    expect(resolveUpstream('GET', '/bff-health')).toBe('self');
    expect(resolveUpstream('GET', '/api/bff/aggregated-health')).toBe('self');
  });

  it('exact /api/accounts goes to monolith for all methods', () => {
    expect(resolveUpstream('GET', '/api/accounts')).toBe('monolith');
    expect(resolveUpstream('POST', '/api/accounts')).toBe('monolith');
  });

  it('account current & members', () => {
    expect(resolveUpstream('GET', '/api/accounts/current')).toBe('account');
    expect(resolveUpstream('GET', '/api/accounts/current/members')).toBe('account');
  });

  it('GET /api/accounts/:id (single segment) to account service', () => {
    expect(resolveUpstream('GET', '/api/accounts/acc-uuid-1')).toBe('account');
  });

  it('nested /api/accounts/... with extra segment goes to monolith', () => {
    expect(resolveUpstream('GET', '/api/accounts/uuid/sub')).toBe('monolith');
  });

  it('invitations to account service', () => {
    expect(resolveUpstream('GET', '/api/invitations')).toBe('account');
    expect(resolveUpstream('POST', '/api/invitations')).toBe('account');
  });

  it('platform accounts: POST to monolith, GET to account service', () => {
    expect(resolveUpstream('POST', '/api/platform/accounts')).toBe('monolith');
    expect(resolveUpstream('GET', '/api/platform/accounts')).toBe('account');
  });

  it('realtime to monolith', () => {
    expect(resolveUpstream('GET', '/realtime')).toBe('monolith');
    expect(resolveUpstream('GET', '/realtime/socket.io/')).toBe('monolith');
  });

  it('default API to monolith', () => {
    expect(resolveUpstream('GET', '/api/jobs')).toBe('monolith');
    expect(resolveUpstream('GET', '/health')).toBe('monolith');
  });

  it('preserves query string in path split', () => {
    expect(resolveUpstream('GET', '/api/accounts/abc?x=1')).toBe('account');
  });

  it('optional pipeline slice when flag set', () => {
    process.env.PIPELINE_SLICE_ENABLED = '1';
    expect(resolveUpstream('GET', '/api/slice/pipeline/verify')).toBe('pipeline');
    process.env.PIPELINE_SLICE_ENABLED = '0';
    expect(resolveUpstream('GET', '/api/slice/pipeline/verify')).toBe('monolith');
  });

  it('optional auth slice when flag set', () => {
    process.env.AUTH_SLICE_ENABLED = '1';
    expect(resolveUpstream('GET', '/api/slice/auth/probe')).toBe('auth');
    process.env.AUTH_SLICE_ENABLED = '0';
    expect(resolveUpstream('GET', '/api/slice/auth/probe')).toBe('monolith');
  });

  it('BFF forwards /api/pipelines to pipeline when BFF_PIPELINES_TO_SLICE set', () => {
    process.env.BFF_PIPELINES_TO_SLICE = '1';
    expect(resolveUpstream('GET', '/api/pipelines')).toBe('pipeline');
    expect(resolveUpstream('PUT', '/api/pipelines/pid/statuses/reorder')).toBe('pipeline');
    process.env.BFF_PIPELINES_TO_SLICE = '0';
    expect(resolveUpstream('GET', '/api/pipelines')).toBe('monolith');
  });
});
