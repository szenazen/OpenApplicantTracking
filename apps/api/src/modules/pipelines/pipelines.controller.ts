import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsArray, IsOptional, IsString, MinLength } from 'class-validator';
import { AccountGuard } from '../../common/account.guard';
import { AccountId } from '../../common/request-context';
import { PipelinesService } from './pipelines.service';

class CreatePipelineDto {
  @IsString() @MinLength(1) name!: string;
  @IsArray() statuses!: Array<{ name: string; color?: string; category?: string }>;
}

class AddStatusDto {
  @IsString() @MinLength(1) name!: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsString() category?: string;
}

class ReorderDto {
  @IsArray() statusIds!: string[];
}

@ApiTags('pipelines')
@ApiBearerAuth()
@ApiHeader({ name: 'x-account-id', required: true })
@UseGuards(AuthGuard('jwt'), AccountGuard)
@Controller('pipelines')
export class PipelinesController {
  constructor(private readonly svc: PipelinesService) {}

  @Get()
  list(@AccountId() accountId: string) {
    return this.svc.list(accountId);
  }

  @Get(':id')
  get(@AccountId() accountId: string, @Param('id') id: string) {
    return this.svc.get(accountId, id);
  }

  @Post()
  create(@AccountId() accountId: string, @Body() dto: CreatePipelineDto) {
    return this.svc.create(accountId, dto.name, dto.statuses);
  }

  @Post(':id/statuses')
  addStatus(@AccountId() accountId: string, @Param('id') id: string, @Body() dto: AddStatusDto) {
    return this.svc.addStatus(accountId, id, dto);
  }

  @Put(':id/statuses/reorder')
  reorder(@AccountId() accountId: string, @Param('id') id: string, @Body() dto: ReorderDto) {
    return this.svc.reorderStatuses(accountId, id, dto.statusIds);
  }
}
