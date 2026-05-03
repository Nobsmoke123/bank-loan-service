import { UserRole } from 'src/prisma/generated/enums';

export class CreateUserDto {
  name: string;
  email: string;
  password: string;
  role: UserRole;
}
