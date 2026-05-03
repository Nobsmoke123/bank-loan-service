import { UserRole } from 'src/prisma/generated/enums';

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRole;
}

export interface JwtDecodedPayload {
  header: {
    alg: string;
    type: string;
    kid: string;
  };
  payload: {
    sub: string;
    email: string;
    role: string;
    iat: number;
    exp: number;
    aud: string;
    iss: string;
    jti: string;
  };
  signature: string;
}
