'use client';

import { createContext, useContext } from 'react';
import type { ApplicationCard, JobMember, JobSummary, Pipeline } from '@/lib/api';

/**
 * Shared job state for every tab under `/dashboard/jobs/[id]/*`.
 *
 * The layout fetches the job once (the API already returns pipeline +
 * applications + team together) and exposes it through this context so tab
 * pages don't double-fetch. The Candidates tab additionally mutates
 * `liveApplications` as cards are dragged so the header summary tiles can
 * stay in sync. The Team tab mutates `members` so the header avatar chips
 * stay current without a reload.
 */
export interface JobContextValue {
  job: JobSummary;
  pipeline: Pipeline;
  /** Applications as loaded from the server — don't mutate. */
  initialApplications: ApplicationCard[];
  /** Latest in-memory snapshot (Kanban publishes here on drag/socket events). */
  liveApplications: ApplicationCard[];
  setLiveApplications: (cards: ApplicationCard[]) => void;
  /** Team members on this job — owned by the layout, updated by the Team tab. */
  members: JobMember[];
  setMembers: (members: JobMember[]) => void;
  /**
   * Merge partial updates into the in-memory job (e.g. after a successful
   * `PATCH /jobs/:id`) so the header + Summary tab reflect edits without a
   * full page reload.
   */
  patchJob: (patch: Partial<JobSummary>) => void;
  /**
   * Re-fetch `GET /jobs/:id` and replace pipeline, applications, and team in
   * context — e.g. after `POST /applications` from Recommendations (Kanban may
   * not be mounted, so socket events alone are not enough).
   */
  refreshJob: () => Promise<void>;
}

const Ctx = createContext<JobContextValue | null>(null);

export const JobProvider = Ctx.Provider;

export function useJob(): JobContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useJob must be used within a /jobs/[id] layout');
  return v;
}
