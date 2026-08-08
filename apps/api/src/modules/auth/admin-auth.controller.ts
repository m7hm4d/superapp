import {
  Header, Body, Controller, Delete, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import {
  zAdminTotpSetup,
  type AdminTotpSetupInput,
  zAdminChangePassword,
  zAdminRecoveryRegenerate,
  type AdminChangePasswordInput,
  type AdminRecoveryRegenerateInput, Role, zAdminLogin } from '@superapp/shared';
import { z } from 'zod';
import { authContextFrom } from '../../common/auth-context';
import { AuthThrottle } from '../../common/auth-throttle';
import {
  AllowScopes,
  CurrentUser,
  Public,
  Roles,
  type RequestUser,
} from '../../common/decorators';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { AdminAuthService, TOTP_ENROLLMENT_SCOPE } from './admin-auth.service';
import { RecoveryCodesService } from './recovery-codes.service';
import { PasskeyService } from './passkey.service';

const zTotpToken = z.object({ totp: z.string().regex(/^\d{6}$/) });
/** استجابة المتصفح تمر كما هي إلى مكتبة WebAuthn التي تتحقق من بنيتها */
const zPasskeyRegistration = z.object({
  response: z.record(z.unknown()),
  label: z.string().max(60).optional(),
});
const zPasskeyAuthentication = z.object({ response: z.record(z.unknown()) });
/** توكن العامل الثاني — يثبت أن كلمة المرور تحققت لتوّها */
const zStepUp = z.object({ stepUpToken: z.string().min(1) });
const zPasskeyLogin = zPasskeyAuthentication.merge(zStepUp);
type PasskeyRegistrationInput = z.infer<typeof zPasskeyRegistration>;
type PasskeyLoginInput = z.infer<typeof zPasskeyLogin>;
type AdminLoginInput = z.infer<typeof zAdminLogin>;
type TotpTokenInput = z.infer<typeof zTotpToken>;

@Controller('auth/admin')
export class AdminAuthController {
  constructor(
    private readonly adminAuth: AdminAuthService,
    private readonly recovery: RecoveryCodesService,
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
  @AllowScopes(TOTP_ENROLLMENT_SCOPE)
  @Post('totp/setup')
  setupTotp(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(zAdminTotpSetup)) body: AdminTotpSetupInput,
  ) {
    // الجسم اختياري: التسجيل الأول لا إثبات له، والاستبدال يشترطه —
    // والخدمة هي من تقرّر أيّهما، لا المتحكّم.
    return this.adminAuth.setupTotp(
      user.id,
      body?.password ? { password: body.password, totp: body.totp, recoveryCode: body.recoveryCode } : undefined,
    );
  }

  /** يعيد جلسة كاملة عند النجاح — فينتهي التسجيل بالمستخدم داخل اللوحة مباشرة */
  @Roles(Role.ADMIN)
  @AllowScopes(TOTP_ENROLLMENT_SCOPE)
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

  /**
   * عامل ثانٍ لا أول: يلزمه توكن يثبت أن كلمة المرور تحققت للتوّ. الخيارات
   * مقصورة على مفاتيح صاحب التوكن.
   */
  @Public()
  @AuthThrottle()
  @HttpCode(200)
  @Post('passkey/login/options')
  async passkeyLoginOptions(
    @Body(new ZodValidationPipe(zStepUp)) body: { stepUpToken: string },
  ) {
    const userId = await this.adminAuth.userIdFromStepUpToken(body.stepUpToken);
    return this.passkeys.authenticationOptions(userId);
  }

  /** إتمام الدخول: كلمة المرور تحققت، والمفتاح هو العامل الثاني */
  @Public()
  @AuthThrottle()
  @HttpCode(200)
  @Post('passkey/login/verify')
  async passkeyLoginVerify(
    @Body(new ZodValidationPipe(zPasskeyLogin)) body: PasskeyLoginInput,
    @Req() req: object,
  ) {
    const userId = await this.adminAuth.userIdFromStepUpToken(body.stepUpToken);
    return this.passkeys.verifyAuthentication(body.response as never, userId, authContextFrom(req));
  }

  /** التسجيل متاح للجلسة الكاملة ولتوكن التسجيل — فيختار الأدمن الجديد مفتاحاً بدل TOTP */
  @Roles(Role.ADMIN)
  @AllowScopes(TOTP_ENROLLMENT_SCOPE)
  @HttpCode(200)
  @Post('passkey/register/options')
  passkeyRegisterOptions(@CurrentUser() user: RequestUser) {
    return this.passkeys.registrationOptions(user.id);
  }

  @Roles(Role.ADMIN)
  @AllowScopes(TOTP_ENROLLMENT_SCOPE)
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

  /**
   * تغيير كلمة المرور: الحالية **مع** عامل ثانٍ.
   *
   * محمي بالجلسة كبقية مسارات هذا المتحكّم، فلا يُقبل بتوكن محدود النطاق —
   * توكن التسجيل أو الخطوة الثانية لا يفتح تغيير كلمة المرور.
   */
  @Roles(Role.ADMIN)
  @HttpCode(200)
  @Post('password')
  changePassword(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(zAdminChangePassword)) body: AdminChangePasswordInput,
    @Req() req: object,
  ) {
    return this.adminAuth.changePassword(user.id, body, authContextFrom(req));
  }

  /** كم رمز استرداد بقي — لتعرف اللوحة متى تنبّه */
  @Roles(Role.ADMIN)
  @Get('recovery-codes')
  recoveryStatus(@CurrentUser() user: RequestUser) {
    return this.recovery.remaining(user.id).then((remaining) => ({ remaining }));
  }

  /**
   * توليد مجموعة جديدة — تُعرض **مرة واحدة** ولا تُخزَّن نصّاً.
   *
   * يشترط كلمة المرور ورمز TOTP: من وصل إلى جهاز مفتوح لا يستطيع أن يطبع
   * لنفسه مفاتيح دخول دائمة.
   */
  @Roles(Role.ADMIN)
  @HttpCode(200)
  @Post('recovery-codes')
  @Header('Cache-Control', 'no-store')
  @Header('Pragma', 'no-cache')
  async regenerateRecovery(
    @CurrentUser() user: RequestUser,
    @Body(new ZodValidationPipe(zAdminRecoveryRegenerate)) body: AdminRecoveryRegenerateInput,
  ) {
    await this.adminAuth.assertPasswordAndSecondFactor(user.id, body.password, { totp: body.totp });
    return { codes: await this.recovery.regenerate(user.id) };
  }
}
