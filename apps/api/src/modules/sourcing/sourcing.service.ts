import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { CandidateImportStatus, Prisma } from '.prisma/regional';
import { RegionRouterService } from '../../infrastructure/region-router/region-router.service';
import {
  ExternalCandidate,
  ExternalSourcingProvider,
  LinkedInStubProvider,
} from './providers/stub-provider';

export interface SourcingSearchOpts {
  query: string;
  source?: string;
  limit?: number;
}

export interface SourcingImportInput {
  source: string;
  externalId: string;
  /** If provided, create an Application on this job after parsing the candidate. */
  jobId?: string;
}

/**
 * External Sourcing Service.
 *
 * Wraps one or more {@link ExternalSourcingProvider}s (currently a stub)
 * and turns their payloads into first-class Candidates in the regional DB.
 *
 * Key properties:
 *   - Idempotent imports: unique(accountId, source, externalId) on
 *     CandidateImport means re-importing the same profile is a no-op that
 *     returns the original Candidate.
 *   - Auditability: every import writes a CandidateImport row with the raw
 *     provider payload and the acting user, plus a `candidate.imported`
 *     AuditEvent stamped with `jobId` (when applicable) so the Activities
 *     feed surfaces inbound candidates alongside other job actions.
 *   - Extensibility: swapping in a real LinkedIn/Indeed provider later is a
 *     matter of adding another class and registering it in `providers`.
 */
@Injectable()
export class SourcingService {
  /** Source id -> provider instance. */
  private readonly providers: Map<string, ExternalSourcingProvider>;

  constructor(private readonly router: RegionRouterService) {
    const stub = new LinkedInStubProvider();
    this.providers = new Map([[stub.source, stub]]);
  }

  listProviders() {
    return Array.from(this.providers.values()).map((p) => ({ source: p.source }));
  }

  async search(opts: SourcingSearchOpts) {
    const source = opts.source ?? 'linkedin-stub';
    const provider = this.providers.get(source);
    if (!provider) throw new BadRequestException(`Unknown sourcing provider: ${source}`);
    const results = await provider.search({ query: opts.query, limit: opts.limit });
    return { source, results };
  }

  async import(
    accountId: string,
    input: SourcingImportInput,
    actorUserId: string,
  ) {
    const provider = this.providers.get(input.source);
    if (!provider) throw new BadRequestException(`Unknown sourcing provider: ${input.source}`);

    const payload = await provider.fetch(input.externalId);
    if (!payload) throw new NotFoundException('External candidate not found');

    const { client } = await this.router.forAccount(accountId);

    // Idempotency: if we've already imported this externalId into the account,
    // return the existing row + linked candidate (no duplicate audit event).
    const prior = await client.candidateImport.findUnique({
      where: {
        accountId_source_externalId: {
          accountId,
          source: input.source,
          externalId: input.externalId,
        },
      },
      include: { candidate: true },
    });
    if (prior && prior.candidate) {
      return { import: prior, candidate: prior.candidate, deduped: true };
    }

    // Verify the job exists (when supplied) before opening the transaction.
    if (input.jobId) {
      const job = await client.job.findFirst({
        where: { id: input.jobId, accountId },
        select: { id: true, pipelineId: true },
      });
      if (!job) throw new NotFoundException('Job not found');
    }

    const { candidate, imp } = await client.$transaction(async (tx) => {
      const existingByEmail = payload.email
        ? await tx.candidate.findUnique({
            where: { accountId_email: { accountId, email: payload.email } },
          })
        : null;

      const candidate =
        existingByEmail ??
        (await tx.candidate.create({
          data: {
            accountId,
            firstName: payload.firstName,
            lastName: payload.lastName,
            email: payload.email ?? null,
            headline: payload.headline ?? null,
            location: payload.location ?? null,
            currentCompany: payload.currentCompany ?? null,
            currentTitle: payload.currentTitle ?? null,
            yearsExperience: payload.yearsExperience ?? null,
            summary: payload.summary ?? null,
            source: input.source,
          },
        }));

      let imp;
      try {
        imp = await tx.candidateImport.create({
          data: {
            accountId,
            candidateId: candidate.id,
            source: input.source,
            externalId: input.externalId,
            status: CandidateImportStatus.COMPLETED,
            rawPayload: payload as unknown as Prisma.InputJsonValue,
            createdBy: actorUserId,
            jobId: input.jobId ?? null,
          },
        });
      } catch (e) {
        // Race on the unique key — another tx imported the same row first.
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
          const existing = await tx.candidateImport.findUnique({
            where: {
              accountId_source_externalId: {
                accountId,
                source: input.source,
                externalId: input.externalId,
              },
            },
          });
          if (existing) imp = existing;
          else throw e;
        } else {
          throw e;
        }
      }

      // Optionally create an application on the target job.
      if (input.jobId) {
        const job = (await tx.job.findFirstOrThrow({
          where: { id: input.jobId, accountId },
          select: { id: true, pipelineId: true },
        }));
        const firstStatus = await tx.pipelineStatus.findFirst({
          where: { pipelineId: job.pipelineId },
          orderBy: { position: 'asc' },
        });
        if (firstStatus) {
          await tx.application.upsert({
            where: { candidateId_jobId: { candidateId: candidate.id, jobId: job.id } },
            create: {
              accountId,
              candidateId: candidate.id,
              jobId: job.id,
              currentStatusId: firstStatus.id,
            },
            update: {},
          });
        }
      }

      await tx.auditEvent.create({
        data: {
          accountId,
          actorUserId,
          action: 'candidate.imported',
          resource: `candidate:${candidate.id}`,
          metadata: {
            jobId: input.jobId ?? null,
            candidateId: candidate.id,
            importId: imp!.id,
            source: input.source,
            externalId: input.externalId,
          },
        },
      });

      return { candidate, imp: imp! };
    });

    return { import: imp, candidate, deduped: false };
  }

  /** Recent imports for the account, newest first. */
  async listImports(accountId: string, limit = 50) {
    const { client } = await this.router.forAccount(accountId);
    const take = Math.max(1, Math.min(200, limit));
    const rows = await client.candidateImport.findMany({
      where: { accountId },
      orderBy: { createdAt: 'desc' },
      take,
      include: { candidate: { select: { id: true, firstName: true, lastName: true, email: true } } },
    });
    return rows;
  }
}
