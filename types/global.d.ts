import { AuthenticatedUser } from 'src/common/interfaces/auth-user.interface';

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}
