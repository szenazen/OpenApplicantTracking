import { BadRequestException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';

const baseUrl = () =>
  (process.env.PIPELINE_SLICE_BASE_URL ?? 'http://127.0.0.1:3030').replace(/\/$/, '');

/**
 * Forwards /api/pipelines traffic to the pipeline slice when `OAT_USE_PIPELINE_SLICE` is on.
 * Pass the same `Authorization` and `x-account-id` the browser sent to the monolith.
 */
@Injectable()
export class PipelinesSliceClientService {
  private async fetchJson(
    method: string,
    path: string,
    authHeader: string | undefined,
    accountId: string,
    body?: object,
  ): Promise<unknown> {
    if (!authHeader) {
      throw new BadRequestException('Authorization required');
    }
    const url = `${baseUrl()}/api/slice/pipeline/accounts/${encodeURIComponent(accountId)}${path}`;
    const r = await fetch(url, {
      method,
      headers: {
        Authorization: authHeader,
        'x-account-id': accountId,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (r.status === 404) {
      throw new NotFoundException(await r.text());
    }
    if (r.status === 400) {
      const errBody = (await r.json().catch(() => ({}))) as object;
      throw new BadRequestException(errBody);
    }
    if (!r.ok) {
      const t = await r.text();
      if (r.status === 502 || r.status === 503) {
        throw new ServiceUnavailableException(t);
      }
      throw new ServiceUnavailableException(`Pipeline slice: ${r.status} ${t}`);
    }
    if (r.status === 204) return undefined;
    return r.json() as Promise<unknown>;
  }

  list(accountId: string, authHeader: string | undefined) {
    return this.fetchJson('GET', '/pipelines', authHeader, accountId);
  }

  get(accountId: string, pipelineId: string, authHeader: string | undefined) {
    return this.fetchJson('GET', `/pipelines/${encodeURIComponent(pipelineId)}`, authHeader, accountId);
  }

  create(
    accountId: string,
    name: string,
    statuses: { name: string; color?: string; category?: string }[],
    authHeader: string | undefined,
  ) {
    return this.fetchJson('POST', '/pipelines', authHeader, accountId, { name, statuses });
  }

  addStatus(
    accountId: string,
    pipelineId: string,
    input: { name: string; color?: string; category?: string; position?: number },
    authHeader: string | undefined,
  ) {
    return this.fetchJson(
      'POST',
      `/pipelines/${encodeURIComponent(pipelineId)}/statuses`,
      authHeader,
      accountId,
      input,
    );
  }

  reorderStatuses(
    accountId: string,
    pipelineId: string,
    orderedStatusIds: string[],
    authHeader: string | undefined,
  ) {
    return this.fetchJson(
      'PUT',
      `/pipelines/${encodeURIComponent(pipelineId)}/statuses/reorder`,
      authHeader,
      accountId,
      { statusIds: orderedStatusIds },
    );
  }

  removeStatus(
    accountId: string,
    pipelineId: string,
    statusId: string,
    authHeader: string | undefined,
  ) {
    return this.fetchJson(
      'DELETE',
      `/pipelines/${encodeURIComponent(pipelineId)}/statuses/${encodeURIComponent(statusId)}`,
      authHeader,
      accountId,
    );
  }
}
