import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ArrayNotEmpty, IsArray, IsOptional, IsString, MinLength } from 'class-validator';
import { AccountMatchGuard } from '../common/account-match.guard';
import { PipelineDomainService } from './pipeline-domain.service';

class CreatePipelineDto {
  @IsString() @MinLength(1) name!: string;
  @IsArray() statuses!: Array<{ name: string; color?: string; category?: string }>;
}

class AddStatusDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsString() category?: string;
  @IsOptional() position?: number;
}

class ReorderDto {
  @IsArray() @ArrayNotEmpty() @IsString({ each: true }) statusIds!: string[];
}

/**
 * REST surface for pipeline + job slice. Monolith can delegate here when
 * `OAT_USE_PIPELINE_SLICE=true` (same JSON shape as /api/pipelines).
 */
@Controller('slice/pipeline/accounts/:accountId')
@UseGuards(AuthGuard('jwt'), AccountMatchGuard)
export class PipelinesRestController {
  constructor(private readonly domain: PipelineDomainService) {}

  @Get('pipelines')
  list(@Param('accountId') accountId: string) {
    return this.domain.list(accountId);
  }

  @Get('pipelines/:id')
  get(@Param('accountId') accountId: string, @Param('id') id: string) {
    return this.domain.get(accountId, id);
  }

  @Post('pipelines')
  create(@Param('accountId') accountId: string, @Body() dto: CreatePipelineDto) {
    return this.domain.create(accountId, dto.name, dto.statuses);
  }

  @Post('pipelines/:id/statuses')
  addStatus(
    @Param('accountId') accountId: string,
    @Param('id') id: string,
    @Body() dto: AddStatusDto,
  ) {
    return this.domain.addStatus(accountId, id, dto);
  }

  @Put('pipelines/:id/statuses/reorder')
  reorder(
    @Param('accountId') accountId: string,
    @Param('id') id: string,
    @Body() dto: ReorderDto,
  ) {
    return this.domain.reorderStatuses(accountId, id, dto.statusIds);
  }

  @Delete('pipelines/:id/statuses/:statusId')
  removeStatus(
    @Param('accountId') accountId: string,
    @Param('id') id: string,
    @Param('statusId') statusId: string,
  ) {
    return this.domain.removeStatus(accountId, id, statusId);
  }
}
