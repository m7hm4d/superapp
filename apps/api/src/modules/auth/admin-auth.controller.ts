import { Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { Role, zAdminLogin } from '@superapp/shared';
import { z } from 'zod';
import { authContextFrom } from '../../common/auth-context';
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
import { PasskeyService } from './passkey.service';

const zTotpToken = z.object({ totp: z.string().regex(/^\d{6}$/) });
/** استجابة المتصفح تمر كما هي إلى مكتبة WebAuthn التي تتحقق من بنيتها */
const zPasskeyRegistration = z.object({
  response: z.record(z.unknown()),
  label: z.string().max(60).optional(),
});
const zPasskeyAuthentication = z.object({ response: z.record(z.unknown()) });
type PasskeyRegistrationInput = z.infer<typeof zPasskeyRegistration>;
type PasskeyAuthenticationInput = z.infer<typeof zPasskeyAuthentication>;
type AdminLoginInput = z.infer<typeof zAdminLogin>;
type TotpTokenInput = z.infer<typeof zTotpToken>;

@Controller('auth/admin')
export class AdminAuthController {
  constructor(
    private readonly adminAuth: AdminAuthService,
    private readonly passkeys: PasskeyService,
  ) {}

  /**
   * يعيد إما جلسة كاملة، أو — إن لم يكن TOTP مسجّلاً بعد — توكن تسجيل محدود
   * بدل الجلسة، إذ لا يُمنح دخول إداري بعامل واحد.
   */
  @Public()
  @AuthThrottle()
  @HttpCode(200)
  @Post('login')
  login(@Body(new ZodValidationPipe(zAdminLogin)) body: AdminLoginInput, @Req() req: object) {
    return this.adminAuth.login(body, authContextFrom(req));
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
    @Req() req: object,
  ) {
    return this.adminAuth.enableTotp(user.id, body.totp, authContextFrom(req));
  }

  // ─────────────────────────── مفاتيح المرور ───────────────────────────

  /** بلا بريد: المفتاح قابل للاكتشاف فيختاره الجهاز — دخول بلمسة */
  @Public()
  @AuthThrottle()
  @HttpCode(200)
  @Post('passkey/login/options')
  passkeyLoginOptions() {
    return this.passkeys.authenticationOptions();
  }

  /** مفتاح المرور عامل كامل بذاته — النجاح يصدر جلسة إدارية مباشرة */
  @Public()
  @AuthThrottle()
  @HttpCode(200)
  @Post('passkey/login/verify')
  passkeyLoginVerify(
    @Body(new ZodValidationPipe(zPasskeyAuthentication)) body: PasskeyAuthenticationInput,
    @Req() req: object,
  ) {
    return this.passkeys.verifyAuthentication(body.response as never, authContextFrom(req));
  }

  /** التسجيل متاح للجلسة الكاملة ولتوكن التسجيل — فيختار الأدمن الجديد مفتاحاً بدل TOTP */
  @Roles(Role.ADMIN)
  @AllowTotpEnrollment()
  @HttpCode(200)
  @Post('passkey/register/options')
  passkeyRegisterOptions(@CurrentUser() user: RequestUser) {
    return this.passkeys.registrationOptions(user.id);
  }

  @Roles(Role.ADMIN)
  @AllowTotpEnrollment()
  @HttpCode(200)
  @Post('passkey/register/verify')
  passkeyRegisterVerify(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(zPasskeyRegistration)) body: PasskeyRegistrationInput,
    @Req() req: object,
  ) {
    return this.passkeys.verifyRegistration(
      user.id,
      body.response as never,
      body.label ?? 'مفتاح مرور',
      authContextFrom(req),
    );
  }

  @Roles(Role.ADMIN)
  @Get('passkeys')
  listPasskeys(@CurrentUser() user: RequestUser) {
    return this.passkeys.list(user.id);
  }

  @Roles(Role.ADMIN)
  @Delete('passkeys/:id')
  removePasskey(@CurrentUser() user: RequestUser, @Param('id') id: string) {
    return this.passkeys.remove(user.id, id);
  }

  @Roles(Role.ADMIN)
  @Get('totp/status')
  totpStatus(@CurrentUser() user: RequestUser) {
    return this.adminAuth.totpStatus(user.id);
  }
}
