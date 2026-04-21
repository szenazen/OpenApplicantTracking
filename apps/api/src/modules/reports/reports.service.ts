import { Injectable, NotFoundException } from '@nestjs/common';
import { RegionRouterService } from '../../infrastructure/region-router/region-router.service';

export interface FunnelEntry {
  statusId: string;
  name: string;
  category: string;
  position: number;
  count: number;
}

export interface TimeInStageEntry {
  statusId: string;
  name: string;
  position: number;
  /** Average seconds applications spent in this stage before moving on. */
  avgSeconds: number | null;
  /** Sample size — number of completed stays used in the average. */
  sampleSize: number;
}

export interface HiresOverTimeEntry {
  /** ISO date (YYYY-MM-DD) of the bucket, in UTC. */
  date: string;
  count: number;
}

export interface JobReport {
  jobId: string;
  generatedAt: string;
  funnel: FunnelEntry[];
  timeInStage: TimeInStageEntry[];
  hiresOverTime: {
    windowDays: number;
    series: HiresOverTimeEntry[];
  };
  totals: {
    applications: number;
    hired: number;
    dropped: number;
    inProgress: number;
  };
}

/**
 * Job-scoped analytics feeding the Reports tab.
 *
 * Three reports, all explainable from first-principles queries so the UI
 * never has to "trust" an opaque number:
 *
 *   1. Funnel — current applications per pipeline stage (snapshot).
 *   2. Time-in-stage — average dwell time in each stage, computed from
 *      consecutive `ApplicationTransition` rows (the stays between moves).
 *   3. Hires over time — daily count of transitions into a HIRED-category
 *      stage over a configurable window (default 30 days).
 *
 * All queries are tenant-scoped by `accountId` (defense in depth) and
 * job-scoped by `jobId` so multi-tenant access is safe.
 */
@Injectable()
export class ReportsService {
  constructor(private readonly router: RegionRouterService) {}

  async forJob(accountId: string, jobId: string, opts: { windowDays?: number } = {}): Promise<JobReport> {
    const windowDays = Math.max(1, Math.min(365, opts.windowDays ?? 30));
    const { client } = await this.router.forAccount(accountId);

    const job = await client.job.findFirst({
      where: { id: jobId, accountId },
      include: {
        pipeline: {
          include: { statuses: { orderBy: { position: 'asc' } } },
        },
      },
    });
    if (!job) throw new NotFoundException('Job not found');

    const statuses = job.pipeline.statuses;

    // --- Funnel: current snapshot ------------------------------------------
    const apps = await client.application.findMany({
      where: { accountId, jobId },
      select: { id: true, currentStatusId: true },
    });
    const byStatus = new Map<string, number>();
    for (const a of apps) byStatus.set(a.currentStatusId, (byStatus.get(a.currentStatusId) ?? 0) + 1);
    const funnel: FunnelEntry[] = statuses.map((s) => ({
      statusId: s.id,
      name: s.name,
      category: s.category,
      position: s.position,
      count: byStatus.get(s.id) ?? 0,
    }));

    // --- Time-in-stage: average dwell per stage -----------------------------
    const transitions = await client.applicationTransition.findMany({
      where: { application: { accountId, jobId } },
      orderBy: [{ applicationId: 'asc' }, { createdAt: 'asc' }],
      select: { applicationId: true, fromStatusId: true, toStatusId: true, createdAt: true },
    });

    const dwellByStatus = new Map<string, { total: number; count: number }>();
    let prevAppId: string | null = null;
    let prevEnter: Date | null = null;
    let prevStatusId: string | null = null;
    for (const t of transitions) {
      if (t.applicationId !== prevAppId) {
        // new application — the first transition is the "enter" into toStatus.
        prevAppId = t.applicationId;
        prevEnter = t.createdAt;
        prevStatusId = t.toStatusId;
        continue;
      }
      // Closing a stay in `prevStatusId` — dwell = now - prevEnter.
      if (prevStatusId && prevEnter) {
        const seconds = Math.max(0, (t.createdAt.getTime() - prevEnter.getTime()) / 1000);
        const agg = dwellByStatus.get(prevStatusId) ?? { total: 0, count: 0 };
        agg.total += seconds;
        agg.count += 1;
        dwellByStatus.set(prevStatusId, agg);
      }
      prevEnter = t.createdAt;
      prevStatusId = t.toStatusId;
    }

    const timeInStage: TimeInStageEntry[] = statuses.map((s) => {
      const d = dwellByStatus.get(s.id);
      return {
        statusId: s.id,
        name: s.name,
        position: s.position,
        avgSeconds: d && d.count > 0 ? d.total / d.count : null,
        sampleSize: d?.count ?? 0,
      };
    });

    // --- Hires over time ----------------------------------------------------
    const hiredStatusIds = statuses.filter((s) => s.category === 'HIRED').map((s) => s.id);
    const droppedStatusIds = statuses.filter((s) => s.category === 'DROPPED').map((s) => s.id);
    const inProgressIds = statuses.filter((s) => s.category !== 'HIRED' && s.category !== 'DROPPED').map((s) => s.id);

    const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
    const hireTransitions = hiredStatusIds.length
      ? await client.applicationTransition.findMany({
          where: {
            application: { accountId, jobId },
            toStatusId: { in: hiredStatusIds },
            createdAt: { gte: since },
          },
          select: { createdAt: true },
        })
      : [];

    const buckets = new Map<string, number>();
    // Pre-seed every day in the window so the UI gets a dense series.
    for (let d = 0; d < windowDays; d++) {
      const day = new Date(since.getTime() + d * 24 * 60 * 60 * 1000);
      buckets.set(isoDate(day), 0);
    }
    for (const t of hireTransitions) {
      const key = isoDate(t.createdAt);
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    const series: HiresOverTimeEntry[] = Array.from(buckets.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([date, count]) => ({ date, count }));

    // --- Totals (funnel totals by category, snapshot) -----------------------
    const totals = {
      applications: apps.length,
      hired: apps.filter((a) => hiredStatusIds.includes(a.currentStatusId)).length,
      dropped: apps.filter((a) => droppedStatusIds.includes(a.currentStatusId)).length,
      inProgress: apps.filter((a) => inProgressIds.includes(a.currentStatusId)).length,
    };

    return {
      jobId: job.id,
      generatedAt: new Date().toISOString(),
      funnel,
      timeInStage,
      hiresOverTime: { windowDays, series },
      totals,
    };
  }
}

function isoDate(d: Date): string {
  // YYYY-MM-DD in UTC so buckets are stable regardless of server tz.
  return d.toISOString().slice(0, 10);
}
