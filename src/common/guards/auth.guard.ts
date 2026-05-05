import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService, TokenExpiredError } from '@nestjs/jwt';
import { PrismaService } from 'src/prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { Request } from 'express';
import {
  JwtDecodedPayload,
  JwtPayload,
} from '../interfaces/jwt-payload.interface';
import { TransactionIsolationLevel } from 'src/prisma/generated/internal/prismaNamespace';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prismaService: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();

    const token =
      String(request.signedCookies['access_token']) ||
      this.extractTokenFromHeader(request);

    if (!token) {
      throw new UnauthorizedException();
    }

    const decoded = this.jwtService.decode<JwtDecodedPayload>(token, {
      complete: true,
      json: true,
    });

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token);

      const result = await this.prismaService.$transaction(
        async (tx) => {
          const [existing_token, user] = await Promise.all([
            tx.token.findFirst({
              where: {
                token_id: decoded.payload.jti,
                id: decoded.header.kid,
              },
            }),

            tx.user.findFirst({
              where: {
                email: decoded.payload.email,
              },
            }),
          ]);

          if (!existing_token || !user || existing_token.is_revoked) {
            return false;
          }

          if (existing_token.tokenVersion !== user.tokenVersion) {
            return false;
          }

          return true;
        },
        {
          isolationLevel: TransactionIsolationLevel.Serializable,
          timeout: 30000,
          maxWait: 30000,
        },
      );

      request.user = {
        email: payload.email,
        id: payload.sub,
        role: payload.role,
        jwt_id: decoded.payload.jti,
        auth_token_id: decoded.header.kid,
      };
      return result;
    } catch (error) {
      if (error instanceof TokenExpiredError) {
        await this.prismaService.$transaction(
          async (tx) => {
            await tx.token.update({
              where: { token_id: decoded.payload.jti, id: decoded.header.kid },
              data: {
                is_revoked: true,
                loggedout_at: new Date(),
              },
            });
          },
          {
            isolationLevel: TransactionIsolationLevel.Serializable,
            maxWait: 30000,
            timeout: 30000,
          },
        );
      }
      console.log(error);
      throw new UnauthorizedException();
    }
  }

  private extractTokenFromHeader(request: Request): string | undefined {
    const [type, token] = request.headers['authorization']?.split(' ') ?? [];
    return type === 'Bearer' ? token : undefined;
  }
}
