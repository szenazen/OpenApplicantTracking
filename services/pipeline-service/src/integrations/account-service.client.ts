import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type MemberProfile = {
  id: string;
  displayName: string | null;
  email: string;
  avatarUrl: string | null;
};

@Injectable()
export class AccountServiceClient {
  private readonly log = new Logger(AccountServiceClient.name);

  constructor(private readonly config: ConfigService) {}

  private baseUrl(): string | undefined {
    const b = this.config.get<string>('ACCOUNT_SERVICE_URL') ?? process.env.ACCOUNT_SERVICE_URL;
    const t = b?.trim();
    return t || undefined;
  }

  /**
   * Active member profiles for `userIds` in this account (via account-service global DB).
   * No-op when `ACCOUNT_SERVICE_URL` or `Authorization` is missing — list/detail still work without owner chips.
   */
  async resolveMemberProfiles(
    accountId: string,
    userIds: string[],
    authorization: string | undefined,
  ): Promise<Map<string, MemberProfile>> {
    const out = new Map<string, MemberProfile>();
    const base = this.baseUrl();
    if (!base || !authorization) return out;

    const unique = [...new Set(userIds.filter(Boolean))].slice(0, 100);
    if (!unique.length) return out;

    try {
      const url = `${base.replace(/\/$/, '')}/api/accounts/current/member-profiles`;
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: authorization,
          'x-account-id': accountId,
        },
        body: JSON.stringify({ userIds: unique }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) {
        this.log.warn(`account-service member-profiles HTTP ${res.status}`);
        return out;
      }
      const body = (await res.json()) as { users?: MemberProfile[] };
      for (const u of body.users ?? []) {
        out.set(u.id, u);
      }
    } catch (e) {
      this.log.warn({ err: String(e) }, 'member-profiles fetch failed');
    }
    return out;
  }
}
