/**
 * Seed script — reproduces the "multi-region Hays" demo from the challenge.
 *
 * Creates:
 *   - RBAC: admin + recruiter roles, permissions
 *   - Skills catalog (dozens of engineering skills)
 *   - One global user `demo@openapplicanttracking.local` (password: `demo1234`)
 *   - Three accounts:
 *       • Hays US           (us-east-1)
 *       • Hays EU           (eu-west-1)
 *       • Hays Singapore    (ap-southeast-1)
 *   - Each account gets: default pipeline (already from AccountsService), 2 jobs,
 *     5 candidates, 7 applications spread across pipeline statuses.
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
    update: {},
    create: {
      email,
      displayName: 'Demo Recruiter',
      credentials: { create: { passwordHash } },
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
        const existing = await regional.job.findFirst({ where: { accountId: dir.id, title: jt.title } });
        const job = existing ?? (await regional.job.create({
          data: {
            accountId: dir.id,
            title: jt.title,
            department: jt.dept,
            location: acc.region,
            status: 'PUBLISHED',
            pipelineId: pipeline.id,
            openedAt: new Date(),
            requiredSkillIds: skills.slice(0, 4).map((s) => s.id),
          },
        }));

        // Five candidates + spread them across statuses
        const names = [
          ['Alice', 'Nguyen'], ['Bob', 'Martin'], ['Carla', 'Singh'],
          ['Diego', 'Rossi'], ['Elif', 'Yılmaz'],
        ];
        for (let i = 0; i < names.length; i++) {
          const [fn, ln] = names[i]!;
          const candidateEmail = `${fn.toLowerCase()}.${ln.toLowerCase()}@${acc.slug}.local`;
          const candidate = await regional.candidate.upsert({
            where: { accountId_email: { accountId: dir.id, email: candidateEmail } },
            update: {},
            create: {
              accountId: dir.id,
              firstName: fn,
              lastName: ln,
              email: candidateEmail,
              headline: `${jt.dept} candidate`,
              location: acc.region,
              yearsExperience: 3 + i,
              source: 'seed',
            },
          });
          // Populate CANDIDATE_SKILLS (junction) with a spread of levels so the
          // drawer has something realistic to render.
          const candidateSkills = skills.slice(i, i + 3).map((s, idx) => ({
            candidateId: candidate.id,
            skillId: s.id,
            level: ((i + idx) % 5) + 1,
          }));
          if (candidateSkills.length) {
            await regional.candidateSkill.createMany({
              data: candidateSkills,
              skipDuplicates: true,
            });
          }
          const status = pipeline.statuses[i % pipeline.statuses.length]!;
          const pos = await regional.application.count({
            where: { jobId: job.id, currentStatusId: status.id },
          });
          const application = await regional.application.upsert({
            where: { candidateId_jobId: { candidateId: candidate.id, jobId: job.id } },
            update: {},
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
    } finally {
      await regional.$disconnect();
    }
  }

  console.log('\n==> Seed complete.');
  console.log(`\n  Login:  ${email}`);
  console.log(`  Password: ${password}\n`);

  await globalDb.$disconnect();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
