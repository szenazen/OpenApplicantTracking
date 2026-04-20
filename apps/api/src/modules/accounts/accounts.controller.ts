import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsIn, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { AccountsService } from './accounts.service';
import { AuthUser, CurrentUser } from '../../common/request-context';

const REGIONS = ['us-east-1', 'eu-west-1', 'ap-southeast-1', 'ap-northeast-1', 'ap-southeast-2'] as const;

class CreateAccountDto {
  @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @Matches(/^[a-z0-9-]{3,40}$/, { message: 'slug must be lowercase alphanumeric/hyphen 3-40 chars' })
  slug!: string;
  @IsIn(REGIONS as unknown as string[]) region!: (typeof REGIONS)[number];
}

@ApiTags('accounts')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('accounts')
export class AccountsController {
  constructor(private readonly svc: AccountsService) {}

  @Post()
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateAccountDto) {
    return this.svc.create({ ownerUserId: user.userId, ...dto });
  }

  @Get(':id')
  get(@CurrentUser() user: AuthUser, @Param('id') id: string) {
    return this.svc.getForUser(user.userId, id);
  }
}
