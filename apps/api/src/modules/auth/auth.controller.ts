import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import {
  zLogin,
  zRefresh,
  zRegister,
  type LoginInput,
  type RegisterInput,
} from '@superapp/shared';
import type { z } from 'zod';
import { authContextFrom } from '../../common/auth-context';
import { AuthThrottle } from '../../common/auth-throttle';
import {
  CurrentUser,
  Public,
  SkipApproval,
  type RequestUser,
} from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';

type RefreshInput = z.infer<typeof zRefresh>;

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  @Public()
  @AuthThrottle()
  @Post('register')
  register(@Body(new ZodValidationPipe(zRegister)) body: RegisterInput) {
    return this.auth.register(body);
  }

  @Public()
  @AuthThrottle()
  @HttpCode(200)
  @Post('login')
  login(@Body(new ZodValidationPipe(zLogin)) body: LoginInput, @Req() req: object) {
    return this.auth.login(body, authContextFrom(req));
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body(new ZodValidationPipe(zRefresh)) body: RefreshInput) {
    return this.tokens.rotate(body.refreshToken);
  }

  @SkipApproval()
  @HttpCode(200)
  @Post('logout')
  logout(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(zRefresh)) body: RefreshInput,
    @Req() req: object,
  ) {
    return this.tokens.logout(user.id, body.refreshToken, authContextFrom(req));
  }

  @SkipApproval()
  @Get('me')
  me(@CurrentUser() user: RequestUser) {
    return this.auth.me(user.id);
  }
}
