import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { Role, zAdminLogin } from '@superapp/shared';
import { z } from 'zod';
import { AuthThrottle } from '../../common/auth-throttle';
import {
  AllowTotpEnrollment,
  CurrentUser,
  Public,
  Roles,
  type RequestUser,
} from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { AdminAuthService } from './admin-auth.service';

const zTotpToken = z.object({ totp: z.string().regex(/^\d{6}$/) });
type AdminLoginInput = z.infer<typeof zAdminLogin>;
type TotpTokenInput = z.infer<typeof zTotpToken>;

@Controller('auth/admin')
export class AdminAuthController {
  constructor(private readonly adminAuth: AdminAuthService) {}

  /**
   * يعيد إما جلسة كاملة، أو — إن لم يكن TOTP مسجّلاً بعد — توكن تسجيل محدود
   * بدل الجلسة، إذ لا يُمنح دخول إداري بعامل واحد.
   */
  @Public()
  @AuthThrottle()
  @HttpCode(200)
  @Post('login')
  login(@Body(new ZodValidationPipe(zAdminLogin)) body: AdminLoginInput) {
    return this.adminAuth.login(body);
  }

  @Roles(Role.ADMIN)
  @AllowTotpEnrollment()
  @Post('totp/setup')
  setupTotp(@CurrentUser() user: RequestUser) {
    return this.adminAuth.setupTotp(user.id);
  }

  /** يعيد جلسة كاملة عند النجاح — فينتهي التسجيل بالمستخدم داخل اللوحة مباشرة */
  @Roles(Role.ADMIN)
  @AllowTotpEnrollment()
  @AuthThrottle()
  @HttpCode(200)
  @Post('totp/enable')
  enableTotp(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(zTotpToken)) body: TotpTokenInput,
  ) {
    return this.adminAuth.enableTotp(user.id, body.totp);
  }

  @Roles(Role.ADMIN)
  @Get('totp/status')
  totpStatus(@CurrentUser() user: RequestUser) {
    return this.adminAuth.totpStatus(user.id);
  }
}
