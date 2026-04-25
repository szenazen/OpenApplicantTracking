import { Body, Controller, Delete, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsArray, IsNumber, IsOptional, IsString, MinLength } from 'class-validator';
import { AccountAdminOrManagerGuard } from '../../common/account-admin-or-manager.guard';
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
  @IsOptional() @IsNumber() position?: number;
}

class ReorderDto {
  @IsArray() statusIds!: string[];
}

@ApiTags('pipelines')
@ApiBearerAuth()
@ApiHeader({ name: 'x-account-id', required: true })
@Controller('pipelines')
export class PipelinesController {
  constructor(private readonly svc: PipelinesService) {}

  @UseGuards(AuthGuard('jwt'), AccountGuard)
  @Get()
  list(@AccountId() accountId: string, @Req() req: Request) {
    return this.svc.list(accountId, this.auth(req));
  }

  @UseGuards(AuthGuard('jwt'), AccountGuard)
  @Get(':id')
  get(@AccountId() accountId: string, @Param('id') id: string, @Req() req: Request) {
    return this.svc.get(accountId, id, this.auth(req));
  }

  @UseGuards(AuthGuard('jwt'), AccountGuard, AccountAdminOrManagerGuard)
  @Post()
  create(@AccountId() accountId: string, @Body() dto: CreatePipelineDto, @Req() req: Request) {
    return this.svc.create(accountId, dto.name, dto.statuses, this.auth(req));
  }

  @UseGuards(AuthGuard('jwt'), AccountGuard, AccountAdminOrManagerGuard)
  @Post(':id/statuses')
  addStatus(
    @AccountId() accountId: string,
    @Param('id') id: string,
    @Body() dto: AddStatusDto,
    @Req() req: Request,
  ) {
    return this.svc.addStatus(accountId, id, dto, this.auth(req));
  }

  @UseGuards(AuthGuard('jwt'), AccountGuard, AccountAdminOrManagerGuard)
  @Put(':id/statuses/reorder')
  reorder(
    @AccountId() accountId: string,
    @Param('id') id: string,
    @Body() dto: ReorderDto,
    @Req() req: Request,
  ) {
    return this.svc.reorderStatuses(accountId, id, dto.statusIds, this.auth(req));
  }

  @UseGuards(AuthGuard('jwt'), AccountGuard, AccountAdminOrManagerGuard)
  @Delete(':id/statuses/:statusId')
  removeStatus(
    @AccountId() accountId: string,
    @Param('id') id: string,
    @Param('statusId') statusId: string,
    @Req() req: Request,
  ) {
    return this.svc.removeStatus(accountId, id, statusId, this.auth(req));
  }

  private auth(req: Request): string | undefined {
    const a = req.headers['authorization'];
    return typeof a === 'string' ? a : Array.isArray(a) ? a[0] : undefined;
  }
}
