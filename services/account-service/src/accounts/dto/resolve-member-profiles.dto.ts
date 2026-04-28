import { ArrayMaxSize, IsArray, IsString } from 'class-validator';

/** Bulk resolve collaborator profiles — only **active members** of the current account. */
export class ResolveMemberProfilesDto {
  @IsArray()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  userIds!: string[];
}
