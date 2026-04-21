'use client';

import { createContext, useContext } from 'react';
import type { ApplicationCard, JobSummary, Pipeline } from '@/lib/api';

/**
 * Shared job state for every tab under `/dashboard/jobs/[id]/*`.
 *
 * The layout fetches the job once (the API already returns pipeline +
 * applications together) and exposes it through this context so tab pages
 * don't double-fetch. The Candidates tab additionally mutates
 * `liveApplications` as cards are dragged so the header summary tiles can
 * stay in sync.
 */
export interface JobContextValue {
  job: JobSummary;
  pipeline: Pipeline;
  /** Applications as loaded from the server — don't mutate. */
  initialApplications: ApplicationCard[];
  /** Latest in-memory snapshot (Kanban publishes here on drag/socket events). */
  liveApplications: ApplicationCard[];
  setLiveApplications: (cards: ApplicationCard[]) => void;
}

const Ctx = createContext<JobContextValue | null>(null);

export const JobProvider = Ctx.Provider;

export function useJob(): JobContextValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useJob must be used within a /jobs/[id] layout');
  return v;
}
