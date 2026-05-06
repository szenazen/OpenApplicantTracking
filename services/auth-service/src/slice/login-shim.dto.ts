import { IsEmail, IsString, MinLength } from 'class-validator';

/** Mirrors `apps/api` `LoginDto` for monolith forwarding. */
export class LoginShimDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}
