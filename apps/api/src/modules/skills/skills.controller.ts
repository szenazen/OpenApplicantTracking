import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { GlobalPrismaService } from '../../infrastructure/prisma/global-prisma.service';

/**
 * Skills catalog — GLOBAL source of truth.
 *
 * We intentionally read from the global datasource (not regional skill cache).
 * In production the regional cache is used by candidate services for perf; the
 * authoritative catalog remains global.
 */
@ApiTags('skills')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('skills')
export class SkillsController {
  constructor(private readonly db: GlobalPrismaService) {}

  @Get()
  list(@Query('q') q?: string, @Query('category') category?: string) {
    return this.db.skill.findMany({
      where: {
        ...(category ? { category } : {}),
        ...(q
          ? { OR: [{ name: { contains: q, mode: 'insensitive' } }, { slug: { contains: q.toLowerCase() } }] }
          : {}),
      },
      orderBy: { name: 'asc' },
      take: 100,
    });
  }
}
