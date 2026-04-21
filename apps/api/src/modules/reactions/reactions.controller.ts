import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  Param,
  Put,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { AccountGuard } from '../../common/account.guard';
import { AccountId, AuthUser, CurrentUser } from '../../common/request-context';
import { REACTION_KINDS, ReactionKind, ReactionsService } from './reactions.service';

@ApiTags('reactions')
@ApiBearerAuth()
@ApiHeader({ name: 'x-account-id', required: true })
@UseGuards(AuthGuard('jwt'), AccountGuard)
@Controller('applications/:applicationId/reactions')
export class ReactionsController {
  constructor(private readonly svc: ReactionsService) {}

  /** Summary of all reactions on this application, plus my own. */
  @Get()
  summary(
    @AccountId() accountId: string,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
  ) {
    return this.svc.summarize(accountId, applicationId, user.userId);
  }

  /** Add my reaction of a given kind — idempotent. */
  @Put(':kind')
  add(
    @AccountId() accountId: string,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Param('kind') kind: string,
  ) {
    return this.svc.add(accountId, applicationId, assertKind(kind), user.userId);
  }

  /** Remove my reaction of a given kind — idempotent. */
  @Delete(':kind')
  remove(
    @AccountId() accountId: string,
    @CurrentUser() user: AuthUser,
    @Param('applicationId') applicationId: string,
    @Param('kind') kind: string,
  ) {
    return this.svc.remove(accountId, applicationId, assertKind(kind), user.userId);
  }
}

function assertKind(k: string): ReactionKind {
  if (!(REACTION_KINDS as readonly string[]).includes(k)) {
    throw new BadRequestException(`Invalid reaction kind '${k}'. Expected one of: ${REACTION_KINDS.join(', ')}`);
  }
  return k as ReactionKind;
}
