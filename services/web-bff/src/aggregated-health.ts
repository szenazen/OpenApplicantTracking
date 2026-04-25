export type UpstreamStatus =
  | { ok: true; status: number; body?: unknown }
  | { ok: false; error: string };

const TIMEOUT_MS = 2_000;

async function getJson(url: string): Promise<UpstreamStatus> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ac.signal });
    let body: unknown;
    const ct = r.headers.get('content-type') ?? '';
    if (ct.includes('application/json')) {
      try {
        body = await r.json();
      } catch {
        body = await r.text();
      }
    } else {
      body = await r.text();
    }
    if (!r.ok) {
      return { ok: false, error: `http ${r.status}` };
    }
    return { ok: true, status: r.status, body };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  } finally {
    clearTimeout(t);
  }
}

export type AggregatedHealthInput = {
  monolithUrl: string;
  accountServiceUrl: string;
  /** When set, probe pipeline slice and kafka ping */
  pipelineServiceUrl?: string;
  authServiceUrl?: string;
  kafkaPingUrl?: string;
};

/**
 * BFF-aggregated snapshot for ops; does not call apps/api code — HTTP only.
 */
export async function buildAggregatedHealth(
  o: AggregatedHealthInput,
): Promise<Record<string, unknown>> {
  const m = o.monolithUrl.replace(/\/$/, '');
  const a = o.accountServiceUrl.replace(/\/$/, '');
  const [monolith, account] = await Promise.all([
    getJson(new URL('/health', `${m}/`).toString()),
    getJson(new URL('/health', `${a}/`).toString()),
  ]);
  const out: Record<string, unknown> = {
    bff: 'ok',
    monolith,
    account,
  };
  if (o.pipelineServiceUrl) {
    const p = o.pipelineServiceUrl.replace(/\/$/, '');
    out.pipeline = await getJson(new URL('/health', `${p}/`).toString());
  }
  if (o.authServiceUrl) {
    const p = o.authServiceUrl.replace(/\/$/, '');
    out.auth = await getJson(new URL('/health', `${p}/`).toString());
  }
  if (o.kafkaPingUrl) {
    const k = o.kafkaPingUrl.replace(/\/$/, '');
    out.kafkaPing = await getJson(new URL('/ready', `${k}/`).toString());
  }
  return out;
}
