import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { UsersService } from 'src/users/users.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { randomUUID } from 'crypto';
import { JwtService } from '@nestjs/jwt';
import { RequestMetadata } from 'src/common/interfaces/request-meta.interface';
import { TransactionIsolationLevel } from 'src/prisma/generated/internal/prismaNamespaceBrowser';
import { JwtPayload } from 'src/common/interfaces/jwt-payload.interface';
import { PrismaClient, User } from 'src/prisma/generated/client';
import { DefaultArgs } from '@prisma/client/runtime/client';
import { AuthenticatedUser } from 'src/common/interfaces/auth-user.interface';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class AuthService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly userService: UsersService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Login method
   * @param loginDto
   * @param requestMeta
   * @returns
   */
  async login(loginDto: LoginDto, requestMeta: RequestMetadata) {
    return await this.prismaService.$transaction(
      async (tx) => {
        const user = await this.userService.findOne(tx, loginDto.email);

        if (!user) {
          throw new UnauthorizedException('Invalid username or password.');
        }

        const access_token = await this.createJwtToken(tx, requestMeta, user);

        return {
          access_token,
          user: {
            email: user.email,
            name: user.name,
            role: user.role,
            created_at: user.created_at,
          },
        };
      },
      {
        isolationLevel: TransactionIsolationLevel.Serializable,
        maxWait: 30000,
        timeout: 30000,
      },
    );
  }

  /**
   * Register method
   * @param registerDto
   * @param requestMeta
   * @returns
   */
  async register(registerDto: RegisterDto, requestMeta: RequestMetadata) {
    return await this.prismaService.$transaction(
      async (tx) => {
        const user = await this.userService.create(tx, registerDto);

        const access_token = await this.createJwtToken(tx, requestMeta, user);

        return {
          access_token,
          user: {
            email: user.email,
            name: user.name,
            role: user.role,
            created_at: user.created_at,
          },
        };
      },
      {
        isolationLevel: TransactionIsolationLevel.Serializable,
        maxWait: 30000,
        timeout: 30000,
      },
    );
  }

  /**
   * createJwtToken
   * @param tx
   * @param requestMeta
   * @param user
   * @returns
   */
  private async createJwtToken(
    tx: Omit<
      PrismaClient<never, undefined, DefaultArgs>,
      '$connect' | '$disconnect' | '$on' | '$use' | '$extends'
    >,
    requestMeta: RequestMetadata,
    user: User,
  ): Promise<string> {
    const jti = randomUUID();

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
    };

    const token = await tx.token.create({
      data: {
        ip_address: requestMeta.ip,
        token_id: jti,
        device_os:
          requestMeta.device.model! +
          ' ' +
          requestMeta.device.type! +
          ' ' +
          requestMeta.device.vendor!,
        user_id: user.id,
        loggedin_at: new Date(),
        tokenVersion: user.tokenVersion,
      },
    });

    const access_token = this.jwtService.sign(payload, {
      jwtid: jti,
      issuer: 'bank-loan-service',
      audience: 'bank-users',
      keyid: token.id,
      expiresIn: this.configService.get('JWT_EXPIRES_IN')!,
    });

    return access_token;
  }

  async logOut(user: AuthenticatedUser) {
    return await this.prismaService.$transaction(async (tx) => {
      const token = await tx.token.findFirst({
        where: {
          id: user.auth_token_id,
          token_id: user.jwt_id,
        },
      });

      if (!token) {
        throw new UnauthorizedException();
      }

      await this.prismaService.token.updateMany({
        where: { id: user.auth_token_id, token_id: user.jwt_id },
        data: {
          is_revoked: true,
          loggedout_at: new Date(),
        },
      });

      return 'Logged out successfully.';
    });
  }
}
