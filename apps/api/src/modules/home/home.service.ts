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
  /**
   * Window for the "My performance" bar chart. 30 days balances signal
   * density (enough action in the chart) against recency (ancient work
   * doesn't help today's decisions).
   */
  private static readonly PERFORMANCE_WINDOW_DAYS = 30;

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

    // ---- "My performance" bar chart ------------------------------------
    //
    // Five metrics, all scoped to the requesting user:
    //   - created       : candidates this user sourced/imported (audit)
    //   - ownedActive   : point-in-time count of non-terminal applications
    //                     on jobs where the user is a JobMember
    //   - addedToJob    : applications this user attached to a job
    //   - dropped       : transitions this user made that landed in DROPPED
    //   - placed        : transitions this user made that landed in HIRED
    //
    // The first, third, fourth and fifth are windowed (last 30 days) so
    // the chart is "activity this month", not lifetime — recruiters track
    // rolling performance.
    const perfSince = new Date(
      now.getTime() - HomeService.PERFORMANCE_WINDOW_DAYS * 86_400_000,
    );
    const [createdByMe, addedToJob, placedByMe, droppedByMe] = await Promise.all([
      client.auditEvent.count({
        where: {
          accountId,
          actorUserId: requesterUserId,
          action: 'candidate.imported',
          createdAt: { gte: perfSince },
        },
      }),
      client.auditEvent.count({
        where: {
          accountId,
          actorUserId: requesterUserId,
          action: 'application.created',
          createdAt: { gte: perfSince },
        },
      }),
      hiredStatusIds.length
        ? client.applicationTransition.count({
            where: {
              application: { accountId },
              byUserId: requesterUserId,
              toStatusId: { in: hiredStatusIds },
              createdAt: { gte: perfSince },
            },
          })
        : Promise.resolve(0),
      droppedStatusIds.length
        ? client.applicationTransition.count({
            where: {
              application: { accountId },
              byUserId: requesterUserId,
              toStatusId: { in: droppedStatusIds },
              createdAt: { gte: perfSince },
            },
          })
        : Promise.resolve(0),
    ]);
    // "Owned" is a current snapshot of active apps on the user's jobs.
    // Drop the window filter so the tile reflects what the user is
    // responsible for *right now*.
    let ownedActive = 0;
    if (myJobIds.size > 0) {
      for (const a of apps) {
        if (!myJobIds.has(a.jobId)) continue;
        const cat = statusCategory.get(a.currentStatusId);
        if (cat && cat !== 'HIRED' && cat !== 'DROPPED') ownedActive += 1;
      }
    }

    // ---- "Recent touched" candidates and jobs for this user ------------
    //
    // Mines audit events to answer "who/what did I work on most recently?".
    // We read a slightly bigger window (last 200) so that even a chatty
    // reaction stream still leaves room for candidate/job signals, then
    // dedupe by resource id and take the top N of each kind.
    const myRecentAudit = await client.auditEvent.findMany({
      where: { accountId, actorUserId: requesterUserId },
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: { resource: true, createdAt: true, metadata: true },
    });
    const recentCandidateIds: string[] = [];
    const recentJobIds: string[] = [];
    const seenCand = new Set<string>();
    const seenJob = new Set<string>();
    for (const row of myRecentAudit) {
      // resource is formatted "<kind>:<id>" across services.
      const [kind, id] = (row.resource ?? '').split(':');
      if (!kind || !id) continue;
      if (kind === 'candidate' && !seenCand.has(id)) {
        seenCand.add(id);
        if (recentCandidateIds.length < 6) recentCandidateIds.push(id);
      } else if (kind === 'job' && !seenJob.has(id)) {
        seenJob.add(id);
        if (recentJobIds.length < 6) recentJobIds.push(id);
      } else if (kind === 'application') {
        // application audit events carry the candidate+job ids in metadata
        const md = (row.metadata as Record<string, unknown>) ?? {};
        const cid = typeof md.candidateId === 'string' ? md.candidateId : null;
        const jid = typeof md.jobId === 'string' ? md.jobId : null;
        if (cid && !seenCand.has(cid)) {
          seenCand.add(cid);
          if (recentCandidateIds.length < 6) recentCandidateIds.push(cid);
        }
        if (jid && !seenJob.has(jid)) {
          seenJob.add(jid);
          if (recentJobIds.length < 6) recentJobIds.push(jid);
        }
      }
      if (recentCandidateIds.length >= 6 && recentJobIds.length >= 6) break;
    }
    const [recentCandidatesRaw, recentJobsRaw] = await Promise.all([
      recentCandidateIds.length
        ? client.candidate.findMany({
            where: { accountId, id: { in: recentCandidateIds } },
            select: {
              id: true,
              firstName: true,
              lastName: true,
              headline: true,
              email: true,
            },
          })
        : Promise.resolve([] as Array<{
            id: string;
            firstName: string;
            lastName: string;
            headline: string | null;
            email: string | null;
          }>),
      recentJobIds.length
        ? client.job.findMany({
            where: { accountId, id: { in: recentJobIds } },
            select: {
              id: true,
              title: true,
              clientName: true,
              department: true,
              status: true,
            },
          })
        : Promise.resolve([] as Array<{
            id: string;
            title: string;
            clientName: string | null;
            department: string | null;
            status: string;
          }>),
    ]);
    // Preserve the original recency order from the audit scan.
    const candById = new Map(recentCandidatesRaw.map((c) => [c.id, c] as const));
    const jobById = new Map(recentJobsRaw.map((j) => [j.id, j] as const));
    const recentTouched = {
      candidates: recentCandidateIds
        .map((id) => candById.get(id))
        .filter((x): x is NonNullable<typeof x> => Boolean(x))
        .slice(0, 4),
      jobs: recentJobIds
        .map((id) => jobById.get(id))
        .filter((x): x is NonNullable<typeof x> => Boolean(x))
        .slice(0, 4),
    };

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
        performanceDays: HomeService.PERFORMANCE_WINDOW_DAYS,
      },
      performance: {
        windowDays: HomeService.PERFORMANCE_WINDOW_DAYS,
        created: createdByMe,
        owned: ownedActive,
        addedToJob,
        dropped: droppedByMe,
        placed: placedByMe,
      },
      recentTouched,
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
