import { Injectable } from '@nestjs/common';
import { GlobalPrismaService } from '../../infrastructure/prisma/global-prisma.service';
import { RegionRouterService } from '../../infrastructure/region-router/region-router.service';

/**
 * Account-wide home dashboard.
 *
 * The /dashboard landing page used to be a flat list of jobs. That worked
 * for one-job demos but stops scaling as soon as a recruiter manages 5+
 * roles in parallel. This service powers a richer "home" view focused on
 * the three questions a recruiter asks first thing in the morning:
 *
 *   1. What's the overall health of my pipeline? — counts by status,
 *      hires/drops in the last 7 days.
 *   2. What needs my attention? — open jobs whose newest activity is
 *      more than `STUCK_THRESHOLD_DAYS` old, sorted by staleness.
 *   3. What just happened? — last N audit events across all my jobs.
 *
 * Everything is computed in a single round-trip per region, so this stays
 * cheap even with hundreds of jobs (we never iterate per-job from the
 * controller).
 *
 * NOTE: scoped strictly by `accountId`, just like every other regional
 * service — defense in depth on top of AccountGuard.
 */
@Injectable()
export class HomeService {
  /** Window in days for the "hires this week" / "drops this week" tiles. */
  private static readonly RECENT_WINDOW_DAYS = 7;
  /** Window in days after which an in-progress job is flagged as stuck. */
  private static readonly STUCK_THRESHOLD_DAYS = 7;

  constructor(
    private readonly router: RegionRouterService,
    private readonly global: GlobalPrismaService,
  ) {}

  async summary(accountId: string, requesterUserId: string) {
    const { client } = await this.router.forAccount(accountId);
    const now = new Date();
    const recentSince = new Date(now.getTime() - HomeService.RECENT_WINDOW_DAYS * 86_400_000);
    const stuckBefore = new Date(now.getTime() - HomeService.STUCK_THRESHOLD_DAYS * 86_400_000);

    // ---- Jobs (status counts + lightweight rows) -------------------------
    const jobs = await client.job.findMany({
      where: { accountId },
      select: {
        id: true,
        title: true,
        status: true,
        department: true,
        location: true,
        openedAt: true,
        closedAt: true,
        createdAt: true,
        pipeline: { select: { id: true, statuses: { select: { id: true, category: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const jobsByStatus = countBy(jobs, (j) => j.status);
    const openJobIds = jobs.filter((j) => j.status === 'PUBLISHED').map((j) => j.id);

    // ---- Applications snapshot (account-wide) ----------------------------
    // Pulling all (id, jobId, currentStatusId, lastTransitionAt) is OK for
    // an MVP — even at 10k applications this is a few hundred KB. If/when
    // that hurts we can switch to a groupBy by (jobId, currentStatusId).
    const apps = await client.application.findMany({
      where: { accountId },
      select: {
        id: true,
        jobId: true,
        currentStatusId: true,
        lastTransitionAt: true,
        appliedAt: true,
      },
    });

    // Map status -> category once per pipeline so we can bucket apps.
    const statusCategory = new Map<string, string>();
    for (const j of jobs) {
      for (const s of j.pipeline.statuses) statusCategory.set(s.id, s.category);
    }

    let inPipeline = 0;
    let hiredCurrent = 0;
    let droppedCurrent = 0;
    for (const a of apps) {
      const cat = statusCategory.get(a.currentStatusId);
      if (cat === 'HIRED') hiredCurrent++;
      else if (cat === 'DROPPED') droppedCurrent++;
      else inPipeline++;
    }

    // ---- Hires & drops in the recent window ------------------------------
    // Instead of counting current-state pills, count actual *transitions*
    // landing in HIRED/DROPPED in the window — this is the trustworthy
    // "this week" number a recruiter expects.
    const allStatusIds = Array.from(statusCategory.keys());
    const hiredStatusIds = allStatusIds.filter((id) => statusCategory.get(id) === 'HIRED');
    const droppedStatusIds = allStatusIds.filter((id) => statusCategory.get(id) === 'DROPPED');

    const [recentHires, recentDrops] = await Promise.all([
      hiredStatusIds.length
        ? client.applicationTransition.count({
            where: {
              application: { accountId },
              toStatusId: { in: hiredStatusIds },
              createdAt: { gte: recentSince },
            },
          })
        : Promise.resolve(0),
      droppedStatusIds.length
        ? client.applicationTransition.count({
            where: {
              application: { accountId },
              toStatusId: { in: droppedStatusIds },
              createdAt: { gte: recentSince },
            },
          })
        : Promise.resolve(0),
    ]);

    // ---- "Needs your attention": stuck open jobs -------------------------
    //
    // For each open job, find the freshest signal of activity:
    //   max(lastTransitionAt, appliedAt) over its applications, fallback to
    //   the job's createdAt. If that's older than the threshold AND the
    //   job has any in-progress applications, surface it.
    //
    // Bonus: include `stuckCount` so the UI can show "3 cards stuck >7d".
    const inProgressByJob = new Map<string, { stuckCount: number; lastActivity: Date | null }>();
    for (const a of apps) {
      const cat = statusCategory.get(a.currentStatusId);
      if (cat === 'HIRED' || cat === 'DROPPED') continue;
      const bucket = inProgressByJob.get(a.jobId) ?? { stuckCount: 0, lastActivity: null };
      const last = a.lastTransitionAt ?? a.appliedAt;
      if (last && (!bucket.lastActivity || last > bucket.lastActivity)) bucket.lastActivity = last;
      if (last && last < stuckBefore) bucket.stuckCount += 1;
      inProgressByJob.set(a.jobId, bucket);
    }

    // A job needs attention if at least one of its in-progress cards has
    // not moved in `STUCK_THRESHOLD_DAYS`. We intentionally don't require
    // the entire job to be stale — a single neglected candidate matters.
    const attention = jobs
      .filter((j) => openJobIds.includes(j.id))
      .map((j) => {
        const agg = inProgressByJob.get(j.id);
        return {
          id: j.id,
          title: j.title,
          department: j.department,
          location: j.location,
          status: j.status,
          lastActivityAt: agg?.lastActivity ?? j.openedAt ?? j.createdAt,
          stuckCount: agg?.stuckCount ?? 0,
        };
      })
      .filter((j) => j.stuckCount > 0)
      .sort((a, b) => a.lastActivityAt.getTime() - b.lastActivityAt.getTime())
      .slice(0, 5);

    // ---- "My jobs": jobs where the requester is a JobMember --------------
    const myMemberships = await client.jobMember.findMany({
      where: { accountId, userId: requesterUserId },
      select: { jobId: true, role: true },
    });
    const myJobIds = new Set(myMemberships.map((m) => m.jobId));
    const roleByJobId = new Map(myMemberships.map((m) => [m.jobId, m.role] as const));
    const myJobs = jobs
      .filter((j) => myJobIds.has(j.id))
      .slice(0, 8)
      .map((j) => ({
        id: j.id,
        title: j.title,
        status: j.status,
        department: j.department,
        location: j.location,
        role: roleByJobId.get(j.id) ?? null,
      }));

    // ---- Recent activity (account-wide, top N) ---------------------------
    const recentRows = await client.auditEvent.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });
    const actorIds = Array.from(
      new Set(recentRows.map((r) => r.actorUserId).filter(Boolean)),
    ) as string[];
    const actors = actorIds.length
      ? await this.global.user.findMany({
          where: { id: { in: actorIds } },
          select: { id: true, displayName: true, email: true, avatarUrl: true },
        })
      : [];
    const actorById = new Map(actors.map((u) => [u.id, u] as const));
    const recentActivity = recentRows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      action: r.action,
      resource: r.resource,
      metadata: (r.metadata as Record<string, unknown>) ?? {},
      actor: r.actorUserId ? actorById.get(r.actorUserId) ?? null : null,
    }));

    return {
      generatedAt: now.toISOString(),
      window: {
        recentDays: HomeService.RECENT_WINDOW_DAYS,
        stuckThresholdDays: HomeService.STUCK_THRESHOLD_DAYS,
      },
      jobs: {
        total: jobs.length,
        byStatus: {
          DRAFT: jobsByStatus.get('DRAFT') ?? 0,
          PUBLISHED: jobsByStatus.get('PUBLISHED') ?? 0,
          ON_HOLD: jobsByStatus.get('ON_HOLD') ?? 0,
          CLOSED: jobsByStatus.get('CLOSED') ?? 0,
          ARCHIVED: jobsByStatus.get('ARCHIVED') ?? 0,
        },
      },
      pipeline: {
        applications: apps.length,
        inPipeline,
        hiredCurrent,
        droppedCurrent,
        hiresInWindow: recentHires,
        dropsInWindow: recentDrops,
      },
      attention,
      myJobs,
      recentActivity,
    };
  }
}

function countBy<T, K extends string>(items: T[], keyFn: (t: T) => K): Map<K, number> {
  const out = new Map<K, number>();
  for (const it of items) {
    const k = keyFn(it);
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}
