import { resolveUpstream } from '../src/routing';

describe('resolveUpstream', () => {
  it('health is self', () => {
    expect(resolveUpstream('GET', '/gateway-health')).toBe('self');
    expect(resolveUpstream('GET', '/bff-health')).toBe('self');
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
});
