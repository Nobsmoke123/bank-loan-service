import {
  IsEmail,
  IsEnum,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { UserRole } from 'src/prisma/generated/enums';

export class RegisterDto {
  @IsString()
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @IsEnum(UserRole, { message: 'UserRole must be CUSTOMER' })
  role: UserRole;

  @IsString()
  @MinLength(8)
  @MaxLength(16)
  password: string;
}
