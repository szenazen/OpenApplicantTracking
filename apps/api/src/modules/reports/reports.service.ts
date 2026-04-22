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

/** Per-stage exits: progressed vs dropped (for drop-off analysis). */
export interface StageDropOffEntry {
  statusId: string;
  name: string;
  position: number;
  category: string;
  /** Transitions from this stage to a non-DROPPED status. */
  advancedCount: number;
  /** Transitions from this stage into DROPPED. */
  droppedCount: number;
  /** advanced + dropped */
  exitTotal: number;
  /** 100 * dropped / exitTotal when exitTotal > 0 */
  dropOffRatePct: number | null;
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
  /** Conversion snapshot from current funnel totals. */
  rates: {
    hiredOfApplicantsPct: number | null;
    droppedOfApplicantsPct: number | null;
    inPipelineOfApplicantsPct: number | null;
  };
  /** Where candidates leave the funnel (stage → dropped vs progressed). */
  stageDropOff: StageDropOffEntry[];
}

/**
 * Job-scoped analytics feeding the Reports tab + CSV export.
 *
 * Explainer-first queries only — no opaque ML. Phase 9 adds:
 *   - Stage drop-off (exits from each stage to DROPPED vs forward),
 *   - Conversion rate tiles (hired / dropped / in-pipeline as % of applicants),
 *   - `csvForJob` for spreadsheet hand-off.
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
    const statusCategory = new Map(statuses.map((s) => [s.id, s.category] as const));

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
        prevAppId = t.applicationId;
        prevEnter = t.createdAt;
        prevStatusId = t.toStatusId;
        continue;
      }
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

    // --- Stage drop-off: fromStatus → DROPPED vs forward --------------------
    const advancedFrom = new Map<string, number>();
    const droppedFrom = new Map<string, number>();
    for (const t of transitions) {
      if (!t.fromStatusId) continue;
      const toCat = statusCategory.get(t.toStatusId);
      if (toCat === 'DROPPED') {
        droppedFrom.set(t.fromStatusId, (droppedFrom.get(t.fromStatusId) ?? 0) + 1);
      } else {
        advancedFrom.set(t.fromStatusId, (advancedFrom.get(t.fromStatusId) ?? 0) + 1);
      }
    }

    const stageDropOff: StageDropOffEntry[] = statuses.map((s) => {
      const advancedCount = advancedFrom.get(s.id) ?? 0;
      const droppedCount = droppedFrom.get(s.id) ?? 0;
      const exitTotal = advancedCount + droppedCount;
      return {
        statusId: s.id,
        name: s.name,
        position: s.position,
        category: s.category,
        advancedCount,
        droppedCount,
        exitTotal,
        dropOffRatePct:
          exitTotal > 0 ? Math.round((1000 * droppedCount) / exitTotal) / 10 : null,
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

    const totals = {
      applications: apps.length,
      hired: apps.filter((a) => hiredStatusIds.includes(a.currentStatusId)).length,
      dropped: apps.filter((a) => droppedStatusIds.includes(a.currentStatusId)).length,
      inProgress: apps.filter((a) => inProgressIds.includes(a.currentStatusId)).length,
    };

    const n = totals.applications;
    const rates = {
      hiredOfApplicantsPct: n > 0 ? Math.round((1000 * totals.hired) / n) / 10 : null,
      droppedOfApplicantsPct: n > 0 ? Math.round((1000 * totals.dropped) / n) / 10 : null,
      inPipelineOfApplicantsPct: n > 0 ? Math.round((1000 * totals.inProgress) / n) / 10 : null,
    };

    return {
      jobId: job.id,
      generatedAt: new Date().toISOString(),
      funnel,
      timeInStage,
      hiresOverTime: { windowDays, series },
      totals,
      rates,
      stageDropOff,
    };
  }

  /**
   * RFC4180-style CSV for recruiters (Excel / Sheets). UTF-8 with BOM so
   * Excel picks up encoding on Windows.
   */
  async csvForJob(accountId: string, jobId: string, opts: { windowDays?: number } = {}): Promise<string> {
    const report = await this.forJob(accountId, jobId, opts);
    const lines: string[] = [];
    const esc = (v: string | number | null | undefined) => {
      if (v === null || v === undefined) return '';
      const s = String(v);
      if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
      return s;
    };

    lines.push('\ufeffsection,key,value');
    lines.push(`meta,jobId,${esc(report.jobId)}`);
    lines.push(`meta,generatedAt,${esc(report.generatedAt)}`);
    lines.push(`meta,reportWindowDays,${report.hiresOverTime.windowDays}`);

    lines.push('totals,applications,' + report.totals.applications);
    lines.push('totals,hired,' + report.totals.hired);
    lines.push('totals,dropped,' + report.totals.dropped);
    lines.push('totals,inProgress,' + report.totals.inProgress);
    lines.push('rates,hiredOfApplicantsPct,' + esc(report.rates.hiredOfApplicantsPct));
    lines.push('rates,droppedOfApplicantsPct,' + esc(report.rates.droppedOfApplicantsPct));
    lines.push('rates,inPipelineOfApplicantsPct,' + esc(report.rates.inPipelineOfApplicantsPct));

    lines.push('funnel,statusId,name,category,position,count');
    for (const f of report.funnel) {
      lines.push(
        ['funnel', esc(f.statusId), esc(f.name), esc(f.category), f.position, f.count].join(','),
      );
    }

    lines.push('dropOff,statusId,name,category,position,advancedCount,droppedCount,exitTotal,dropOffRatePct');
    for (const d of report.stageDropOff) {
      lines.push(
        [
          'dropOff',
          esc(d.statusId),
          esc(d.name),
          esc(d.category),
          d.position,
          d.advancedCount,
          d.droppedCount,
          d.exitTotal,
          esc(d.dropOffRatePct),
        ].join(','),
      );
    }

    lines.push('timeInStage,statusId,name,position,avgSeconds,sampleSize');
    for (const t of report.timeInStage) {
      lines.push(
        [
          'timeInStage',
          esc(t.statusId),
          esc(t.name),
          t.position,
          t.avgSeconds == null ? '' : Math.round(t.avgSeconds),
          t.sampleSize,
        ].join(','),
      );
    }

    lines.push('hiresByDay,date,count');
    for (const h of report.hiresOverTime.series) {
      lines.push(['hiresByDay', esc(h.date), h.count].join(','));
    }

    return lines.join('\r\n');
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
