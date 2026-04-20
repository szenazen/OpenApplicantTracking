import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsArray, IsEmail, IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { AccountGuard } from '../../common/account.guard';
import { AccountId } from '../../common/request-context';
import { CandidatesService } from './candidates.service';

class CreateCandidateDto {
  @IsString() @MinLength(1) firstName!: string;
  @IsString() @MinLength(1) lastName!: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() phone?: string;
  @IsOptional() @IsString() headline?: string;
  @IsOptional() @IsString() location?: string;
  @IsOptional() @IsString() currentCompany?: string;
  @IsOptional() @IsString() currentTitle?: string;
  @IsOptional() @IsInt() @Min(0) yearsExperience?: number;
  @IsOptional() @IsString() summary?: string;
  @IsOptional() @IsString() source?: string;
  @IsOptional() @IsArray() skillIds?: string[];
}

@ApiTags('candidates')
@ApiBearerAuth()
@ApiHeader({ name: 'x-account-id', required: true })
@UseGuards(AuthGuard('jwt'), AccountGuard)
@Controller('candidates')
export class CandidatesController {
  constructor(private readonly svc: CandidatesService) {}

  @Get()
  list(@AccountId() accountId: string, @Query('q') q?: string) {
    return this.svc.list(accountId, { q });
  }

  @Get(':id')
  get(@AccountId() accountId: string, @Param('id') id: string) {
    return this.svc.get(accountId, id);
  }

  @Post()
  create(@AccountId() accountId: string, @Body() dto: CreateCandidateDto) {
    return this.svc.create(accountId, dto);
  }
}
