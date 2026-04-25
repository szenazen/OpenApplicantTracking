/**
 * One-off: copy pipeline-related rows from a regional DB into the pipeline-service DB
 * with the same primary keys, so /api/pipelines (slice) matches jobs.applicationIds
 * in the monolith for a given account.
 *
 * Usage (from repo root, after prisma generate in both places):
 *   REGIONAL_SOURCE_URL="postgresql://..." PIPELINE_SLICE_DATABASE_URL="postgresql://..." \
 *   ACCOUNT_ID="cuid" pnpm --filter @oat/api exec tsx scripts/drain-pipelines-to-slice.ts
 *
 * Order: clear slice rows for the account, then insert pipelines, statuses, jobs, applications.
 * Jobs are reduced to the minimal slice model (title, status, pipelineId, headCount).
 */

import { PrismaClient as Regional } from '.prisma/regional';
import { PrismaClient as Slice } from '../../../services/pipeline-service/src/generated/pipeline';

const accountId = process.env.ACCOUNT_ID;
const regionalUrl = process.env.REGIONAL_SOURCE_URL;
const sliceUrl = process.env.PIPELINE_SLICE_DATABASE_URL;

if (!accountId || !regionalUrl || !sliceUrl) {
  // eslint-disable-next-line no-console
  console.error('Required: ACCOUNT_ID, REGIONAL_SOURCE_URL, PIPELINE_SLICE_DATABASE_URL');
  process.exit(1);
}

const regional = new Regional({ datasources: { db: { url: regionalUrl } } });
const slice = new Slice({ datasources: { db: { url: sliceUrl } } });

async function main() {
  const pipelines = await regional.pipeline.findMany({
    where: { accountId },
    include: { statuses: { orderBy: { position: 'asc' } } },
  });
  const jobs = await regional.job.findMany({ where: { accountId } });
  const applications = await regional.application.findMany({ where: { accountId } });

  await slice.application.deleteMany({ where: { accountId } });
  await slice.job.deleteMany({ where: { accountId } });
  await slice.pipeline.deleteMany({ where: { accountId } });

  for (const p of pipelines) {
    await slice.pipeline.create({
      data: {
        id: p.id,
        accountId: p.accountId,
        name: p.name,
        description: p.description,
        isDefault: p.isDefault,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        statuses: {
          create: p.statuses.map((s) => ({
            id: s.id,
            name: s.name,
            position: s.position,
            color: s.color,
            category: s.category,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
          })),
        },
      },
    });
  }

  for (const j of jobs) {
    await slice.job.upsert({
      where: { id: j.id },
      create: {
        id: j.id,
        accountId: j.accountId,
        title: j.title,
        status: j.status,
        pipelineId: j.pipelineId,
        headCount: j.headCount,
        createdAt: j.createdAt,
        updatedAt: j.updatedAt,
      },
      update: {
        title: j.title,
        status: j.status,
        pipelineId: j.pipelineId,
        headCount: j.headCount,
        updatedAt: j.updatedAt,
      },
    });
  }

  for (const a of applications) {
    await slice.application.upsert({
      where: { id: a.id },
      create: {
        id: a.id,
        accountId: a.accountId,
        currentStatusId: a.currentStatusId,
        jobId: a.jobId,
        createdAt: a.createdAt,
        updatedAt: a.updatedAt,
      },
      update: {
        currentStatusId: a.currentStatusId,
        jobId: a.jobId,
        updatedAt: a.updatedAt,
      },
    });
  }

  // eslint-disable-next-line no-console
  console.log(
    `Drained: ${pipelines.length} pipelines, ${jobs.length} jobs, ${applications.length} applications for account ${accountId}`,
  );
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await regional.$disconnect();
    await slice.$disconnect();
  });
