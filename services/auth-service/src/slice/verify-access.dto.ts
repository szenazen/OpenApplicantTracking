import { IsString, MinLength } from 'class-validator';

/** Body for offline verification of browser access JWTs minted by the backup API (`apps/api`). */
export class VerifyAccessDto {
  @IsString()
  @MinLength(20, { message: 'accessToken required' })
  accessToken!: string;
}
