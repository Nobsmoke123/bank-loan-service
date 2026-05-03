import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RequestMeta } from 'src/common/decorators/request-meta.decorator';
import { RequestMetadata } from 'src/common/interfaces/request-meta.interface';
import { Public } from 'src/common/decorators/public.decorator';
import { AuthGuard } from 'src/common/guards/auth.guard';
import { CurrentUser } from 'src/common/decorators/current-user.decorator';
import { AuthenticatedUser } from 'src/common/interfaces/auth-user.interface';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('register')
  async signUp(
    @Body() signUpDto: RegisterDto,
    @RequestMeta() meta: RequestMetadata,
  ) {
    return this.authService.register(signUpDto, meta);
  }

  @Public()
  @Post('login')
  async signIn(
    @Body() signInDto: LoginDto,
    @RequestMeta() meta: RequestMetadata,
  ) {
    return this.authService.login(signInDto, meta);
  }

  @UseGuards(AuthGuard)
  @Post('logout')
  async logOut(@CurrentUser() user: AuthenticatedUser) {
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
}
