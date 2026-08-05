import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Role, zAdminLogin } from '@superapp/shared';
import { z } from 'zod';
import { CurrentUser, Public, Roles, type RequestUser } from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { AdminAuthService } from './admin-auth.service';

const zTotpToken = z.object({ totp: z.string().regex(/^\d{6}$/) });
type AdminLoginInput = z.infer<typeof zAdminLogin>;
type TotpTokenInput = z.infer<typeof zTotpToken>;

@Controller('auth/admin')
export class AdminAuthController {
  constructor(private readonly adminAuth: AdminAuthService) {}

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  login(@Body(new ZodValidationPipe(zAdminLogin)) body: AdminLoginInput) {
    return this.adminAuth.login(body);
  }

  @Roles(Role.ADMIN)
  @Post('totp/setup')
  setupTotp(@CurrentUser() user: RequestUser) {
    return this.adminAuth.setupTotp(user.id);
  }

  @Roles(Role.ADMIN)
  @Post('totp/enable')
  enableTotp(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(zTotpToken)) body: TotpTokenInput,
  ) {
    return this.adminAuth.enableTotp(user.id, body.totp);
  }
}
