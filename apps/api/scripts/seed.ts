/**
 * Seed script — reproduces the "multi-region Hays" demo from the challenge.
 *
 * Creates:
 *   - RBAC: admin + recruiter roles, permissions
 *   - Skills catalog (dozens of engineering skills)
 *   - Users: `demo@openapplicanttracking.local` + `platform@openapplicanttracking.local`
 *     (password: `demo1234`; platform user may provision accounts in any region)
 *   - Three accounts:
 *       • Hays US           (us-east-1)
 *       • Hays EU           (eu-west-1)
 *       • Hays Singapore    (ap-southeast-1)
 *   - Each account gets: default pipeline, 2 generic engineering jobs +
 *     "Director of Platform Engineering" (Sylvain Zenatti in Technical Interview),
 *     5 candidates per generic job (10 applications) on the Kanban, plus eight
 *     "pool" candidates (skills only, no applications) for Recommendations with
 *     varied match signals; re-seed updates pool rows and replaces their skills.
 *
 * Replicates `skills` into each regional `skill_cache`.
 *
 * Usage: `pnpm db:seed`
 */
import { PrismaClient as GlobalPrisma } from '.prisma/global';
import { PrismaClient as RegionalPrisma } from '.prisma/regional';
import * as bcrypt from 'bcryptjs';

const SKILLS = [
  ['typescript', 'TypeScript', 'language'],
  ['javascript', 'JavaScript', 'language'],
  ['python', 'Python', 'language'],
  ['go', 'Go', 'language'],
  ['rust', 'Rust', 'language'],
  ['java', 'Java', 'language'],
  ['react', 'React', 'frontend'],
  ['nextjs', 'Next.js', 'frontend'],
  ['vue', 'Vue', 'frontend'],
  ['nodejs', 'Node.js', 'backend'],
  ['nestjs', 'NestJS', 'backend'],
  ['django', 'Django', 'backend'],
  ['postgresql', 'PostgreSQL', 'database'],
  ['redis', 'Redis', 'database'],
  ['kafka', 'Kafka', 'messaging'],
  ['aws', 'AWS', 'cloud'],
  ['gcp', 'GCP', 'cloud'],
  ['azure', 'Azure', 'cloud'],
  ['kubernetes', 'Kubernetes', 'devops'],
  ['terraform', 'Terraform', 'devops'],
  ['docker', 'Docker', 'devops'],
];

const REGION_MAP = {
  'us-east-1': 'US_EAST_1',
  'eu-west-1': 'EU_WEST_1',
  'ap-southeast-1': 'AP_SOUTHEAST_1',
  'ap-northeast-1': 'AP_NORTHEAST_1',
  'ap-southeast-2': 'AP_SOUTHEAST_2',
} as const;

async function main() {
  const globalDb = new GlobalPrisma({ datasources: { db: { url: process.env.GLOBAL_DATABASE_URL } } });
  await globalDb.$connect();

  console.log('\n==> Seeding global: roles, permissions, skills');

  const perms = await Promise.all(
    [
      ['job', 'create'], ['job', 'read'], ['job', 'update'],
      ['candidate', 'create'], ['candidate', 'read'], ['candidate', 'update'],
      ['application', 'create'], ['application', 'read'], ['application', 'move'],
      ['pipeline', 'create'], ['pipeline', 'update'],
      ['account', 'read'], ['account', 'update'],
    ].map(([resource, action]) =>
      globalDb.permission.upsert({
        where: { resource_action: { resource: resource!, action: action! } },
        update: {},
        create: { resource: resource!, action: action! },
      }),
    ),
  );

  const adminRole = await globalDb.role.upsert({
    where: { name: 'admin' },
    update: {},
    create: { name: 'admin', scope: 'ACCOUNT', isSystem: true, description: 'Full access within an account' },
  });
  await globalDb.role.upsert({
    where: { name: 'recruiter' },
    update: {},
    create: { name: 'recruiter', scope: 'ACCOUNT', isSystem: true, description: 'Manage candidates and applications' },
  });
  await globalDb.role.upsert({
    where: { name: 'hiring_manager' },
    update: {},
    create: {
      name: 'hiring_manager',
      scope: 'ACCOUNT',
      isSystem: true,
      description: 'Hiring manager — interview and decision workflows',
    },
  });
  await globalDb.role.upsert({
    where: { name: 'viewer' },
    update: {},
    create: { name: 'viewer', scope: 'ACCOUNT', isSystem: true, description: 'Read-only account access' },
  });
  await globalDb.role.upsert({
    where: { name: 'account_manager' },
    update: {},
    create: {
      name: 'account_manager',
      scope: 'ACCOUNT',
      isSystem: true,
      description: 'Manage account pipeline, settings, and invitations (not full admin)',
    },
  });
  await globalDb.rolePermission.createMany({
    data: perms.map((p) => ({ roleId: adminRole.id, permissionId: p.id })),
    skipDuplicates: true,
  });

  const skills = [] as Array<{ id: string; slug: string; name: string; category: string }>;
  for (const [slug, name, category] of SKILLS) {
    const s = await globalDb.skill.upsert({
      where: { slug },
      update: { name, category },
      create: { slug, name, category },
    });
    skills.push({ id: s.id, slug: s.slug, name: s.name, category: s.category ?? 'other' });
  }

  // Demo user
  const email = 'demo@openapplicanttracking.local';
  const password = 'demo1234';
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await globalDb.user.upsert({
    where: { email },
    update: { platformAdmin: false },
    create: {
      email,
      displayName: 'Demo Recruiter',
      platformAdmin: false,
      credentials: { create: { passwordHash } },
    },
  });

  const platformEmail = 'platform@openapplicanttracking.local';
  const platformHash = await bcrypt.hash(password, 10);
  await globalDb.user.upsert({
    where: { email: platformEmail },
    update: { platformAdmin: true },
    create: {
      email: platformEmail,
      displayName: 'Platform Admin',
      platformAdmin: true,
      credentials: { create: { passwordHash: platformHash } },
    },
  });

  // Three accounts across three regions
  const wantedAccounts = [
    { slug: 'hays-us', name: 'Hays US', region: 'us-east-1' as const },
    { slug: 'hays-eu', name: 'Hays EU', region: 'eu-west-1' as const },
    { slug: 'hays-sg', name: 'Hays Singapore', region: 'ap-southeast-1' as const },
  ];

  for (const acc of wantedAccounts) {
    const regionalUrl = process.env[`REGION_${acc.region.toUpperCase().replace(/-/g, '_')}_DATABASE_URL`];
    if (!regionalUrl) {
      console.warn(`[seed] skipping ${acc.slug} — REGION_${acc.region} not configured`);
      continue;
    }
    console.log(`\n==> Seeding account ${acc.slug} (${acc.region})`);

    // Global directory
    const dir = await globalDb.accountDirectory.upsert({
      where: { slug: acc.slug },
      update: {},
      create: {
        name: acc.name,
        slug: acc.slug,
        region: REGION_MAP[acc.region] as any,
        ownerUserId: user.id,
      },
    });

    // Membership
    await globalDb.membership.upsert({
      where: { userId_accountId: { userId: user.id, accountId: dir.id } },
      update: {},
      create: { userId: user.id, accountId: dir.id, roleId: adminRole.id, status: 'ACTIVE' },
    });

    const regional = new RegionalPrisma({ datasources: { db: { url: regionalUrl } } });
    await regional.$connect();

    try {
      // Account row
      await regional.account.upsert({
        where: { id: dir.id },
        update: {},
        create: { id: dir.id, name: acc.name, slug: acc.slug, region: acc.region },
      });

      // Replicate skills into regional cache
      for (const s of skills) {
        await regional.skillCache.upsert({
          where: { id: s.id },
          update: { name: s.name, slug: s.slug, category: s.category },
          create: { id: s.id, slug: s.slug, name: s.name, category: s.category },
        });
      }

      // Default pipeline
      let pipeline = await regional.pipeline.findFirst({
        where: { accountId: dir.id, isDefault: true },
        include: { statuses: { orderBy: { position: 'asc' } } },
      });
      if (!pipeline) {
        pipeline = await regional.pipeline.create({
          data: {
            accountId: dir.id,
            name: 'Default Pipeline',
            isDefault: true,
            statuses: {
              create: [
                { name: 'New candidate', position: 0, category: 'NEW', color: '#60a5fa' },
                { name: 'Screening', position: 1, category: 'IN_PROGRESS', color: '#a78bfa' },
                { name: 'HR Interview', position: 2, category: 'IN_PROGRESS', color: '#f472b6' },
                { name: 'Technical Interview', position: 3, category: 'IN_PROGRESS', color: '#facc15' },
                { name: 'Offer', position: 4, category: 'IN_PROGRESS', color: '#fb923c' },
                { name: 'Hired', position: 5, category: 'HIRED', color: '#22c55e' },
                { name: 'Dropped', position: 6, category: 'DROPPED', color: '#ef4444' },
              ],
            },
          },
          include: { statuses: { orderBy: { position: 'asc' } } },
        });
      }

      // Two jobs
      const jobTitles = [
        { title: `Senior Backend Engineer — ${acc.region}`, dept: 'Engineering' },
        { title: `Full-Stack Developer — ${acc.region}`, dept: 'Engineering' },
      ];
      for (const jt of jobTitles) {
        // Idempotent seed: if the job exists we keep it (to preserve ids the
        // user might already be linked to), otherwise create it. In both
        // cases we still re-run the candidate + candidate_skills loop below
        // so newly introduced tables (e.g. candidate_skills) get populated.
        let job = await regional.job.findFirst({ where: { accountId: dir.id, title: jt.title } });
        if (!job) {
          job = await regional.job.create({
            data: {
              accountId: dir.id,
              title: jt.title,
              department: jt.dept,
              location: acc.region,
              status: 'PUBLISHED',
              pipelineId: pipeline.id,
              openedAt: new Date(),
              requiredSkillIds: skills.slice(0, 4).map((s) => s.id),
              ownerId: user.id,
            },
          });
        } else if (!job.ownerId) {
          job = await regional.job.update({
            where: { id: job.id },
            data: { ownerId: user.id },
          });
        }

        await regional.jobMember.upsert({
          where: { jobId_userId: { jobId: job.id, userId: user.id } },
          update: { role: 'OWNER' },
          create: {
            accountId: dir.id,
            jobId: job.id,
            userId: user.id,
            role: 'OWNER',
            createdBy: user.id,
          },
        });

        // Always take statuses from *this job's* pipeline. Using the account
        // default pipeline here breaks as soon as a job uses another pipeline
        // (or the default was recreated): applications would point at foreign
        // status ids that don't match the board, and in bad cases nothing gets
        // created if ids diverged after a partial reset.
        const jobPipeline = await regional.pipeline.findFirst({
          where: { id: job.pipelineId, accountId: dir.id },
          include: { statuses: { orderBy: { position: 'asc' } } },
        });
        if (!jobPipeline || jobPipeline.statuses.length === 0) {
          console.warn(
            `[seed] skip applications for job "${jt.title}" — pipeline ${job.pipelineId} missing or has no statuses`,
          );
          continue;
        }

        // Five candidates + spread them across statuses — distinct skill bundles +
        // YoE spread so Recommendations shows varied match % (not everyone sharing
        // the same three tags).
        const names = [
          ['Alice', 'Nguyen'], ['Bob', 'Martin'], ['Carla', 'Singh'],
          ['Diego', 'Rossi'], ['Elif', 'Yılmaz'],
        ];
        /** Index into `skills` — TypeScript, React, Node, Python, … */
        const kanbanSkillSets = [
          [0, 6, 9],
          [2, 11, 12],
          [3, 12, 17],
          [4, 5, 14],
          [8, 10, 13],
        ];
        const kanbanYoe = [2, 5, 9, 14, 18];
        for (let i = 0; i < names.length; i++) {
          const [fn, ln] = names[i]!;
          const candidateEmail = `${fn.toLowerCase()}.${ln.toLowerCase()}@${acc.slug}.local`;
          const candidate = await regional.candidate.upsert({
            where: { accountId_email: { accountId: dir.id, email: candidateEmail } },
            update: {
              headline: `${jt.dept} candidate`,
              location: acc.region,
              yearsExperience: kanbanYoe[i]!,
            },
            create: {
              accountId: dir.id,
              firstName: fn,
              lastName: ln,
              email: candidateEmail,
              headline: `${jt.dept} candidate`,
              location: acc.region,
              yearsExperience: kanbanYoe[i]!,
              source: 'seed',
            },
          });
          const skillIdxs = kanbanSkillSets[i]!;
          const candidateSkills = skillIdxs.map((skillIdx, idx) => ({
            candidateId: candidate.id,
            skillId: skills[skillIdx]!.id,
            level: ((i + idx) % 5) + 1,
          }));
          if (candidateSkills.length) {
            await regional.candidateSkill.deleteMany({ where: { candidateId: candidate.id } });
            await regional.candidateSkill.createMany({ data: candidateSkills });
          }
          const status = jobPipeline.statuses[i % jobPipeline.statuses.length]!;
          const pos = await regional.application.count({
            where: { jobId: job.id, currentStatusId: status.id },
          });
          const application = await regional.application.upsert({
            where: { candidateId_jobId: { candidateId: candidate.id, jobId: job.id } },
            update: {
              accountId: dir.id,
              currentStatusId: status.id,
            },
            create: {
              accountId: dir.id,
              candidateId: candidate.id,
              jobId: job.id,
              currentStatusId: status.id,
              position: pos,
            },
          });
          // Design (APPLICATION_STATUS_HISTORY) expects a transition row for
          // every state change — including the initial "null → <status>"
          // creation event. ApplicationsService.apply writes this for real
          // applies; seed data would otherwise have an empty audit trail.
          const existingCreate = await regional.applicationTransition.findFirst({
            where: { applicationId: application.id, fromStatusId: null },
            select: { id: true },
          });
          if (!existingCreate) {
            await regional.applicationTransition.create({
              data: {
                applicationId: application.id,
                fromStatusId: null,
                toStatusId: status.id,
                byUserId: user.id,
              },
            });
          }
        }
      }

      // Director of Platform Engineering + Sylvain Zenatti in Technical Interview.
      const directorTitle = 'Director of Platform Engineering';
      let directorJob = await regional.job.findFirst({
        where: { accountId: dir.id, title: directorTitle },
      });
      if (!directorJob) {
        directorJob = await regional.job.create({
          data: {
            accountId: dir.id,
            title: directorTitle,
            department: 'Engineering',
            location: acc.region,
            status: 'PUBLISHED',
            pipelineId: pipeline.id,
            openedAt: new Date(),
            requiredSkillIds: [skills[0]!.id, skills[3]!.id, skills[15]!.id, skills[18]!.id],
            ownerId: user.id,
          },
        });
      } else if (!directorJob.ownerId) {
        directorJob = await regional.job.update({
          where: { id: directorJob.id },
          data: { ownerId: user.id },
        });
      }

      await regional.jobMember.upsert({
        where: { jobId_userId: { jobId: directorJob.id, userId: user.id } },
        update: { role: 'OWNER' },
        create: {
          accountId: dir.id,
          jobId: directorJob.id,
          userId: user.id,
          role: 'OWNER',
          createdBy: user.id,
        },
      });

      const directorPipeline = await regional.pipeline.findFirst({
        where: { id: directorJob.pipelineId, accountId: dir.id },
        include: { statuses: { orderBy: { position: 'asc' } } },
      });
      const technicalInterviewStatus = directorPipeline?.statuses.find(
        (s) => s.name === 'Technical Interview',
      );
      if (!technicalInterviewStatus) {
        console.warn(`[seed] skip Sylvain Zenatti — no "Technical Interview" status on pipeline`);
      } else {
        const szEmail = `sylvain.zenatti@${acc.slug}.local`;
        const sylvain = await regional.candidate.upsert({
          where: { accountId_email: { accountId: dir.id, email: szEmail } },
          update: {
            firstName: 'Sylvain',
            lastName: 'Zenatti',
            headline: 'Platform engineering leadership',
            currentTitle: 'Senior manager of engineering - Platform',
            location: acc.region,
            yearsExperience: 14,
          },
          create: {
            accountId: dir.id,
            firstName: 'Sylvain',
            lastName: 'Zenatti',
            email: szEmail,
            headline: 'Platform engineering leadership',
            currentTitle: 'Senior manager of engineering - Platform',
            location: acc.region,
            yearsExperience: 14,
            source: 'seed',
          },
        });
        const szSkillIdxs = [0, 3, 9, 15, 16, 17, 18];
        await regional.candidateSkill.deleteMany({ where: { candidateId: sylvain.id } });
        await regional.candidateSkill.createMany({
          data: szSkillIdxs.map((skillIdx, idx) => ({
            candidateId: sylvain.id,
            skillId: skills[skillIdx]!.id,
            level: (idx % 2) + 4,
          })),
        });
        const tiPos = await regional.application.count({
          where: { jobId: directorJob.id, currentStatusId: technicalInterviewStatus.id },
        });
        const szApp = await regional.application.upsert({
          where: { candidateId_jobId: { candidateId: sylvain.id, jobId: directorJob.id } },
          update: {
            accountId: dir.id,
            currentStatusId: technicalInterviewStatus.id,
          },
          create: {
            accountId: dir.id,
            candidateId: sylvain.id,
            jobId: directorJob.id,
            currentStatusId: technicalInterviewStatus.id,
            position: tiPos,
          },
        });
        const szExistingCreate = await regional.applicationTransition.findFirst({
          where: { applicationId: szApp.id, fromStatusId: null },
          select: { id: true },
        });
        if (!szExistingCreate) {
          await regional.applicationTransition.create({
            data: {
              applicationId: szApp.id,
              fromStatusId: null,
              toStatusId: technicalInterviewStatus.id,
              byUserId: user.id,
            },
          });
        }
      }

      // Talent pool: no applications — Recommendations tab.
      // Required job skills are the first four catalog entries (TypeScript, JS,
      // Python, Go). Profiles deliberately vary: full/partial overlap, location
      // vs job (`acc.region`), title tokens vs job title, and YoE. Re-seeds
      // refresh candidate rows + replace skills so match % stays visible.
      const poolProfiles = [
        {
          fn: 'Ivy',
          ln: 'Chen',
          yoe: 8,
          headline: 'Polyglot services — TS / Go / Python',
          title: 'Senior Backend Engineer',
          location: acc.region,
          company: 'Northwind Labs',
          /** All four required skills */
          skillIdxs: [0, 1, 2, 3],
        },
        {
          fn: 'Frank',
          ln: 'Owens',
          yoe: 5,
          headline: 'APIs & service design',
          title: 'Backend Engineer',
          location: acc.region,
          company: 'Contoso',
          /** Missing Go — 3/4 required */
          skillIdxs: [0, 1, 2, 11, 12],
        },
        {
          fn: 'Grace',
          ln: 'Park',
          yoe: 12,
          headline: 'Infra & delivery',
          title: 'Platform Engineer',
          location: 'Berlin, Germany',
          company: 'Fabrikam EU',
          /** TS + Go only — 2/4 required; location far from job */
          skillIdxs: [0, 3, 16, 17, 18],
        },
        {
          fn: 'Henry',
          ln: 'Kovacs',
          yoe: 1,
          headline: 'Learning full-stack',
          title: 'Junior Web Developer',
          location: acc.region,
          company: 'Starter Co',
          /** JavaScript only — 1/4; low YoE */
          skillIdxs: [1, 6, 13],
        },
        {
          fn: 'Jack',
          ln: 'Malik',
          yoe: 10,
          headline: 'End-to-end product engineer',
          title: 'Staff Full-Stack Engineer',
          location: 'Austin, TX',
          company: 'AdventureWorks',
          /** All four + React; US city ≠ region string → weak location */
          skillIdxs: [0, 1, 2, 3, 6],
        },
        {
          fn: 'Kate',
          ln: 'Liu',
          yoe: 4,
          headline: 'Data platforms',
          title: 'Data Engineer',
          location: acc.region,
          company: 'WideWorld',
          /** Python + Go — 2/4; title tokens differ from backend job */
          skillIdxs: [2, 3, 12, 15, 19],
        },
        {
          fn: 'Leo',
          ln: 'Santos',
          yoe: 18,
          headline: 'Long-tenured backend lead',
          title: 'Distinguished Engineer',
          location: 'San Francisco, CA',
          company: 'Proseware',
          /** All four required; SF vs us-east-1 → no location overlap */
          skillIdxs: [0, 1, 2, 3, 9],
        },
        {
          fn: 'Mia',
          ln: 'Brown',
          yoe: 17,
          headline: 'Leadership & architecture',
          title: 'Engineering Director',
          location: 'London, UK',
          company: 'BlueYonder',
          /** JS + Python — 2/4; very senior → YoE curve penalizes */
          skillIdxs: [1, 2, 6, 11],
        },
      ] as const;
      for (const p of poolProfiles) {
        const candidateEmail = `${p.fn.toLowerCase()}.${p.ln.toLowerCase()}.pool@${acc.slug}.local`;
        const poolCand = await regional.candidate.upsert({
          where: { accountId_email: { accountId: dir.id, email: candidateEmail } },
          update: {
            firstName: p.fn,
            lastName: p.ln,
            headline: p.headline,
            currentTitle: p.title,
            currentCompany: p.company,
            location: p.location,
            yearsExperience: p.yoe,
          },
          create: {
            accountId: dir.id,
            firstName: p.fn,
            lastName: p.ln,
            email: candidateEmail,
            headline: p.headline,
            currentTitle: p.title,
            currentCompany: p.company,
            location: p.location,
            yearsExperience: p.yoe,
            source: 'seed-pool',
          },
        });
        const poolSkills = p.skillIdxs.map((skillIdx, idx) => ({
          candidateId: poolCand.id,
          skillId: skills[skillIdx]!.id,
          level: (idx % 3) + 2,
        }));
        await regional.candidateSkill.deleteMany({ where: { candidateId: poolCand.id } });
        if (poolSkills.length) {
          await regional.candidateSkill.createMany({ data: poolSkills });
        }
      }

      const appCount = await regional.application.count({ where: { accountId: dir.id } });
      const jobCount = await regional.job.count({ where: { accountId: dir.id } });
      if (jobCount > 0 && appCount === 0) {
        console.warn(
          `[seed] ${acc.slug}: ${jobCount} jobs but 0 applications — check pipeline statuses / re-run after fixing jobs`,
        );
      } else {
        console.log(
          `[seed] ${acc.slug}: ${appCount} application rows (${jobCount} jobs; expect ~10 apps for two seeded jobs × five candidates)`,
        );
      }
    } finally {
      await regional.$disconnect();
    }
  }

  console.log('\n==> Seed complete.');
  console.log(`\n  Demo login:     ${email}`);
  console.log(`  Platform admin: platform@openapplicanttracking.local`);
  console.log(`  Password:       ${password}\n`);

  await globalDb.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
