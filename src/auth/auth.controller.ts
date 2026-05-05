import { Body, Controller, Get, Post, Res, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RequestMeta } from 'src/common/decorators/request-meta.decorator';
import { RequestMetadata } from 'src/common/interfaces/request-meta.interface';
import { Public } from 'src/common/decorators/public.decorator';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { AuthenticatedUser } from 'src/common/interfaces/auth-user.interface';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Public()
  @Post('register')
  async signUp(
    @Body() signUpDto: RegisterDto,
    @RequestMeta() meta: RequestMetadata,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.register(signUpDto, meta);

    this.attachCookie(res, result.access_token);

    return result.user;
  }

  @Public()
  @Post('login')
  async signIn(
    @Body() signInDto: LoginDto,
    @RequestMeta() meta: RequestMetadata,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.login(signInDto, meta);

    this.attachCookie(res, result.access_token);

    return result.user;
  }

  @UseGuards(AuthGuard)
  @Post('logout')
  async logOut(
    @CurrentUser() user: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.clearCookie('access_token', {
      maxAge: 0,
      expires: new Date(),
      httpOnly: true,
    });
    return this.authService.logOut(user);
  }

  @UseGuards(AuthGuard)
  @Get('me')
  profile(@CurrentUser() user: AuthenticatedUser) {
    return {
      id: user.id,
      email: user.email,
      role: user.role,
    };
  }

  private attachCookie(res: Response, access_token: string) {
    res.cookie('access_token', access_token, {
      httpOnly: true,
      secure: this.configService.get<string>('NODE_ENV')! === 'production',
      sameSite: 'lax',
      maxAge: parseInt(this.configService.get('JWT_EXPIRES_IN')!) * 60 * 1000,
      signed: true,
    });
  }
}
