import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateIf } from 'class-validator';
import { PlatformAdminGuard } from '../../common/platform-admin.guard';
import { PlatformService } from './platform.service';

const REGIONS = ['us-east-1', 'eu-west-1', 'ap-southeast-1', 'ap-northeast-1', 'ap-southeast-2'] as const;

class CreatePlatformAccountDto {
  @IsString() @MinLength(2) @MaxLength(80) name!: string;
  @Matches(/^[a-z0-9-]{3,40}$/, { message: 'slug must be lowercase alphanumeric/hyphen 3-40 chars' })
  slug!: string;
  @IsIn(REGIONS as unknown as string[]) region!: (typeof REGIONS)[number];

  @ValidateIf((o: CreatePlatformAccountDto) => !o.ownerEmail)
  @IsString()
  @MinLength(1)
  ownerUserId?: string;

  @ValidateIf((o: CreatePlatformAccountDto) => !o.ownerUserId)
  @IsEmail()
  ownerEmail?: string;
}

@ApiTags('platform')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), PlatformAdminGuard)
@Controller('platform')
export class PlatformController {
  constructor(private readonly svc: PlatformService) {}

  @Get('accounts')
  listAccounts() {
    return this.svc.listAccounts();
  }

  @Post('accounts')
  createAccount(@Body() dto: CreatePlatformAccountDto) {
    return this.svc.createAccount(dto);
  }
}
