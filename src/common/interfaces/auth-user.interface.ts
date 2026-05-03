import { UserRole } from 'src/prisma/generated/enums';

export interface AuthenticatedUser {
  id: string;
  email: string;
  role: UserRole;
  jwt_id: string;
  auth_token_id: string;
}
