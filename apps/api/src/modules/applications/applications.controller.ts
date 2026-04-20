import { Body, Controller, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min, MinLength } from 'class-validator';
import { AccountGuard } from '../../common/account.guard';
import { AccountId, AuthUser, CurrentUser } from '../../common/request-context';
import { ApplicationsService } from './applications.service';

class CreateApplicationDto {
  @IsString() @MinLength(1) candidateId!: string;
  @IsString() @MinLength(1) jobId!: string;
  @IsOptional() @IsString() statusId?: string;
}

class MoveApplicationDto {
  @IsString() @MinLength(1) toStatusId!: string;
  @IsInt() @Min(0) toPosition!: number;
  @IsOptional() @IsString() reason?: string;
}

@ApiTags('applications')
@ApiBearerAuth()
@ApiHeader({ name: 'x-account-id', required: true })
@UseGuards(AuthGuard('jwt'), AccountGuard)
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly svc: ApplicationsService) {}

  @Post()
  apply(@AccountId() accountId: string, @CurrentUser() user: AuthUser, @Body() dto: CreateApplicationDto) {
    return this.svc.apply(accountId, dto, user.userId);
  }

  @Patch(':id/move')
  move(
    @AccountId() accountId: string,
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() dto: MoveApplicationDto,
  ) {
    return this.svc.move(accountId, id, dto, user.userId);
  }
}
