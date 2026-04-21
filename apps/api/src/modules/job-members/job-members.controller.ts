import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString } from 'class-validator';
import { AccountGuard } from '../../common/account.guard';
import { AccountId, CurrentUser, AuthUser } from '../../common/request-context';
import { JobMembersService } from './job-members.service';

const ROLES = ['OWNER', 'RECRUITER', 'HIRING_MANAGER', 'INTERVIEWER', 'OBSERVER'] as const;

class AddJobMemberDto {
  @IsString() userId!: string;
  @IsOptional() @IsIn(ROLES as unknown as string[]) role?: string;
}

class UpdateJobMemberDto {
  @IsIn(ROLES as unknown as string[]) role!: string;
}

@ApiTags('job-members')
@ApiBearerAuth()
@ApiHeader({ name: 'x-account-id', required: true })
@UseGuards(AuthGuard('jwt'), AccountGuard)
@Controller()
export class JobMembersController {
  constructor(private readonly svc: JobMembersService) {}

  @Get('jobs/:jobId/members')
  list(@AccountId() accountId: string, @Param('jobId') jobId: string) {
    return this.svc.listForJob(accountId, jobId);
  }

  @Post('jobs/:jobId/members')
  add(
    @AccountId() accountId: string,
    @Param('jobId') jobId: string,
    @Body() dto: AddJobMemberDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.add(accountId, jobId, { userId: dto.userId, role: dto.role as any }, user.userId);
  }

  @Patch('job-members/:id')
  update(
    @AccountId() accountId: string,
    @Param('id') id: string,
    @Body() dto: UpdateJobMemberDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.update(accountId, id, { role: dto.role as any }, user.userId);
  }

  @Delete('job-members/:id')
  remove(
    @AccountId() accountId: string,
    @Param('id') id: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.remove(accountId, id, user.userId);
  }
}
