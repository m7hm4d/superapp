import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { AuthTokens, AuthUser, Role, UserStatus } from '@superapp/shared';
import * as argon2 from 'argon2';
import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { DB, DbClient } from '../../db/drizzle.module';
import { adminCredentials, users } from '../../db/schema';
import { AuthEventsService, type AuthContext } from './auth-events.service';
import { PasskeyService } from './passkey.service';
import { ARGON2_OPTIONS } from './auth.service';
import { RecoveryCodesService } from './recovery-codes.service';
import { TokenService } from './token.service';
import { totp, verifyTotpStep } from './totp';

/** نطاق توكن التسجيل: لا يفتح إلا مساري إعداد/تفعيل TOTP */
export const TOTP_ENROLLMENT_SCOPE = 'admin_totp_enrollment';
/** مهلة قصيرة — التسجيل يتم في جلسة واحدة أمام تطبيق المصادقة */
const ENROLLMENT_TTL_SEC = 15 * 60;

/**
 * نطاق توكن العامل الثاني: يُصدر بعد التحقق من كلمة المرور وحدها، ولا يفتح
 * شيئاً سوى إتمام الدخول بمفتاح مرور. حارس JWT يرفض أي توكن يحمل `scope`
 * كجلسة، فلا يصلح هذا للوصول إلى أي مسار إداري.
 */
export const ADMIN_STEP_UP_SCOPE = 'admin_step_up';
/** دقيقتان: زمن اختيار عامل وإتمامه، لا أكثر */
const STEP_UP_TTL_SEC = 2 * 60;

const TOTP_ISSUER = 'SuperApp Admin';

export interface AdminSession {
  status: 'ok';
  user: AuthUser;
  tokens: AuthTokens;
}

export interface AdminEnrollmentRequired {
  status: 'totp_enrollment_required';
  /** توكن محدود الصلاحية — يُقبل فقط على auth/admin/totp/setup و/enable */
  enrollmentToken: string;
  expiresInSec: number;
  email: string;
}

/** عوامل التأكيد المتاحة لهذا الحساب */
export type AdminSecondFactor = 'totp' | 'passkey';

export interface AdminSecondFactorRequired {
  status: 'second_factor_required';
  /** توكن قصير يثبت أن كلمة المرور تحققت — يلزم لإتمام الدخول بمفتاح المرور */
  stepUpToken: string;
  expiresInSec: number;
  /** ما يملكه هذا الحساب فعلاً — الواجهة تعرض ما هو متاح لا ما هو ممكن */
  methods: AdminSecondFactor[];
  email: string;
}

export type AdminLoginResult =
  | AdminSession
  | AdminEnrollmentRequired
  | AdminSecondFactorRequired;

/**
 * دخول الإدارة مستقل عن تدفق الهاتف: بريد + كلمة مرور قوية + عامل ثانٍ.
 *
 * العامل الثاني يختاره الأدمن: رمز TOTP أو مفتاح مرور. كلاهما يأتي **بعد**
 * كلمة المرور لا بدلاً منها — فمفتاح متزامن على جهاز مسروق مفتوح لا يكفي
 * وحده لدخول لوحة الإدارة، ويبقى عامل «ما تعرفه» شرطاً.
 *
 * ومن لم يسجّل عاملاً بعدُ لا يحصل على جلسة، بل على توكن تسجيل محدود.
 */
@Injectable()
export class AdminAuthService {
  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly tokens: TokenService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly events: AuthEventsService,
    private readonly passkeys: PasskeyService,
    private readonly recoveryCodes: RecoveryCodesService,
  ) {}

  async login(
    input: {
      email: string;
      password: string;
      totp?: string;
      recoveryCode?: string;
    },
    ctx: AuthContext = {},
  ): Promise<AdminLoginResult> {
    const event = { ...ctx, method: 'admin_password_totp' as const };
    const [row] = await this.db
      .select({ cred: adminCredentials, user: users })
      .from(adminCredentials)
      .innerJoin(users, eq(users.id, adminCredentials.userId))
      .where(eq(adminCredentials.email, input.email.toLowerCase().trim()))
      .limit(1);

    if (!row || row.user.role !== Role.ADMIN) {
      await this.events.record({ ...event, outcome: 'unknown_identifier' });
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS' });
    }
    if (row.user.status === UserStatus.BLOCKED) {
      await this.events.record({ ...event, userId: row.user.id, outcome: 'blocked' });
      throw new ForbiddenException({ code: 'BLOCKED' });
    }
    const ok = await argon2.verify(row.user.passwordHash, input.password);
    if (!ok) {
      await this.events.record({ ...event, userId: row.user.id, outcome: 'invalid_credentials' });
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS' });
    }

    // كلمة المرور وحدها لا تفتح شيئاً. ما تملكه هذه الحساب من عوامل يحدّد
    // الخطوة التالية: تسجيل عامل أول مرة، أو اختيار عامل لإتمام الدخول.
    const hasTotp = row.cred.totpEnabled && Boolean(row.cred.totpSecret);
    const passkeyCount = await this.passkeys.countFor(row.user.id);

    if (!hasTotp && passkeyCount === 0) {
      await this.events.record({ ...event, userId: row.user.id, outcome: 'enrollment_required' });
      return {
        status: 'totp_enrollment_required',
        enrollmentToken: await this.issueEnrollmentToken(row.user.id),
        expiresInSec: ENROLLMENT_TTL_SEC,
        email: row.cred.email,
      };
    }

    // رمز استرداد بدل TOTP: للجهاز الضائع. يُستهلك مرة واحدة، ويُقبل حتى
    // لو لم يكن TOTP مفعّلاً — فقد يكون العامل الوحيد الباقي بيد صاحبه.
    //
    // ويسقط في مسار النجاح نفسه أدناه لا في نسخة منه: مسارا دخول ينتهيان
    // إلى ردَّين مبنيَّين على حدة يتباعدان بصمت.
    if (input.recoveryCode) {
      const consumed = await this.recoveryCodes.consume(row.user.id, input.recoveryCode);
      if (!consumed) {
        await this.events.record({ ...event, userId: row.user.id, outcome: 'totp_invalid' });
        throw new UnauthorizedException({ code: 'RECOVERY_CODE_INVALID' });
      }
    } else if (input.totp) {
      if (!hasTotp) {
        await this.events.record({ ...event, userId: row.user.id, outcome: 'totp_required' });
        throw new UnauthorizedException({ code: 'TOTP_NOT_ENABLED' });
      }
      await this.consumeTotp(row.user.id, row.cred.totpSecret!, input.totp, event);
    } else {
      // بلا رمز: تُعرَض العوامل المتاحة مع توكن يثبت أن كلمة المرور تحققت
      const methods: AdminSecondFactor[] = [];
      if (hasTotp) methods.push('totp');
      if (passkeyCount > 0) methods.push('passkey');
      await this.events.record({ ...event, userId: row.user.id, outcome: 'totp_required' });
      return {
        status: 'second_factor_required',
        stepUpToken: await this.issueStepUpToken(row.user.id),
        expiresInSec: STEP_UP_TTL_SEC,
        methods,
        email: row.cred.email,
      };
    }

    const tokens = await this.tokens.issuePairWithFamily(row.user);
    await this.events.record({
      ...event,
      userId: row.user.id,
      outcome: 'success',
      sessionFamilyId: tokens.familyId,
    });
    return {
      status: 'ok',
      user: {
        id: row.user.id,
        phone: row.user.phone,
        fullName: row.user.fullName,
        role: row.user.role,
      },
      tokens,
    };
  }

  /**
   * توليد سر TOTP جديد في خانة "قيد التسجيل" — لا يمس السر الفعّال،
   * فإعادة التسجيل لا تُعطّل تطبيق المصادقة القائم قبل تأكيد الجديد.
   */
  async setupTotp(userId: string): Promise<{ secret: string; otpauthUrl: string }> {
    const [cred] = await this.db
      .select()
      .from(adminCredentials)
      .where(eq(adminCredentials.userId, userId))
      .limit(1);
    if (!cred) throw new ForbiddenException({ code: 'NO_ADMIN_CREDENTIALS' });

    const secret = totp.generateSecret();
    await this.db
      .update(adminCredentials)
      .set({ pendingTotpSecret: secret })
      .where(eq(adminCredentials.userId, userId));
    return {
      secret,
      otpauthUrl: totp.keyuri(cred.email, TOTP_ISSUER, secret),
    };
  }

  /** تفعيل TOTP بعد التحقق من أول رمز — يترقّى السر المعلّق إلى فعّال وتُصدر جلسة كاملة */
  async enableTotp(userId: string, token: string, ctx: AuthContext = {}): Promise<AdminSession> {
    const [cred] = await this.db
      .select()
      .from(adminCredentials)
      .where(eq(adminCredentials.userId, userId))
      .limit(1);
    if (!cred?.pendingTotpSecret) throw new ForbiddenException({ code: 'TOTP_NOT_SETUP' });

    const step = verifyTotpStep(token, cred.pendingTotpSecret);
    if (step === null) {
      throw new UnauthorizedException({ code: 'TOTP_INVALID' });
    }

    await this.db
      .update(adminCredentials)
      .set({
        totpSecret: cred.pendingTotpSecret,
        pendingTotpSecret: null,
        totpEnabled: true,
        // الرمز المستعمل في التفعيل مستهلَك — لا يصلح للدخول بعدها
        lastTotpStep: step,
      })
      .where(eq(adminCredentials.userId, userId));

    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user || user.role !== Role.ADMIN) {
      throw new ForbiddenException({ code: 'NO_ADMIN_CREDENTIALS' });
    }
    const tokens = await this.tokens.issuePairWithFamily(user);
    await this.events.record({
      ...ctx,
      method: 'admin_password_totp',
      userId: user.id,
      outcome: 'enrollment_completed',
      sessionFamilyId: tokens.familyId,
    });
    return {
      status: 'ok',
      user: {
        id: user.id,
        phone: user.phone,
        fullName: user.fullName,
        role: user.role,
      },
      tokens,
    };
  }

  /** حالة TOTP للحساب — تستعملها شاشة الإعدادات */
  async totpStatus(userId: string): Promise<{ enabled: boolean; pending: boolean }> {
    const [cred] = await this.db
      .select({
        enabled: adminCredentials.totpEnabled,
        pending: adminCredentials.pendingTotpSecret,
      })
      .from(adminCredentials)
      .where(eq(adminCredentials.userId, userId))
      .limit(1);
    if (!cred) throw new ForbiddenException({ code: 'NO_ADMIN_CREDENTIALS' });
    return { enabled: cred.enabled, pending: cred.pending !== null };
  }

  private async issueStepUpToken(userId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, role: Role.ADMIN, scope: ADMIN_STEP_UP_SCOPE },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: STEP_UP_TTL_SEC,
      },
    );
  }

  /**
   * يفكّ توكن العامل الثاني ويعيد صاحبه. النطاق يُفحص صراحةً: توكن تسجيل
   * أو جلسة كاملة لا يصلح لإتمام دخول — ولا العكس.
   */
  async userIdFromStepUpToken(token: string): Promise<string> {
    let payload: { sub?: unknown; scope?: unknown };
    try {
      payload = await this.jwt.verifyAsync(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException({ code: 'STEP_UP_INVALID' });
    }
    if (payload.scope !== ADMIN_STEP_UP_SCOPE || typeof payload.sub !== 'string') {
      throw new UnauthorizedException({ code: 'STEP_UP_INVALID' });
    }
    return payload.sub;
  }

  private async issueEnrollmentToken(userId: string): Promise<string> {
    return this.jwt.signAsync(
      { sub: userId, role: Role.ADMIN, scope: TOTP_ENROLLMENT_SCOPE },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: ENROLLMENT_TTL_SEC,
      },
    );
  }

  /**
   * يتحقق من الرمز ويستهلكه: التحديث المشروط على last_totp_step هو القفل —
   * محاولتان بالرمز نفسه (إعادة استخدام أو سباق) تنجح إحداهما فقط.
   */
  /**
   * تغيير كلمة مرور الإدارة.
   *
   * لم يكن للمنتج مسار لهذا: كل تدوير يمرّ بالخادم وSSH وسجلّات الأوامر —
   * وكلمة مرور تُكتب في سطر أوامر تبقى في تاريخ الصدفة وفي أعين من يقرأ.
   *
   * الشرطان معاً لا أحدهما: **الحالية** تمنع من جلس إلى جهاز مفتوح،
   * و**العامل الثاني** يمنع من سرق الحالية وحدها.
   *
   * وتُبطَل الجلسات كلها بعدها — تغيير كلمة المرور يعني عادةً أن صاحبها
   * يشكّ في تسريبها، فبقاء جلسة قائمة على جهاز آخر يُفرغ الإجراء من معناه.
   */
  async changePassword(
    userId: string,
    input: { currentPassword: string; newPassword: string; totp?: string; recoveryCode?: string },
    ctx: AuthContext = {},
  ): Promise<{ ok: true }> {
    const event = { ...ctx, method: 'admin_password_totp' as const };
    const [row] = await this.db
      .select({ cred: adminCredentials, user: users })
      .from(adminCredentials)
      .innerJoin(users, eq(users.id, adminCredentials.userId))
      .where(eq(adminCredentials.userId, userId))
      .limit(1);
    if (!row) throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS' });

    const ok = await argon2.verify(row.user.passwordHash, input.currentPassword);
    if (!ok) {
      await this.events.record({ ...event, userId, outcome: 'invalid_credentials' });
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS' });
    }

    // عامل ثانٍ إلزامي — بلا استثناء لمن لم يفعّل شيئاً: من لا عامل له لا
    // يصل إلى هنا أصلاً، فالدخول يوقفه عند التسجيل.
    if (input.recoveryCode) {
      const consumed = await this.recoveryCodes.consume(userId, input.recoveryCode);
      if (!consumed) throw new UnauthorizedException({ code: 'RECOVERY_CODE_INVALID' });
    } else if (input.totp) {
      if (!row.cred.totpEnabled || !row.cred.totpSecret) {
        throw new UnauthorizedException({ code: 'TOTP_NOT_ENABLED' });
      }
      await this.consumeTotp(userId, row.cred.totpSecret, input.totp, event);
    } else {
      throw new UnauthorizedException({ code: 'SECOND_FACTOR_REQUIRED' });
    }

    // كلمة جديدة مطابقة للقديمة تعني تدويراً لم يقع — ورفضها يمنع الظنّ به
    if (await argon2.verify(row.user.passwordHash, input.newPassword)) {
      throw new BadRequestException({ code: 'PASSWORD_UNCHANGED' });
    }

    await this.db
      .update(users)
      .set({ passwordHash: await argon2.hash(input.newPassword, ARGON2_OPTIONS) })
      .where(eq(users.id, userId));

    await this.tokens.revokeAllForUser(userId, 'password changed');
    await this.events.record({ ...event, userId, outcome: 'session_revoked' });
    return { ok: true };
  }

  /**
   * يتحقق من كلمة المرور ورمز TOTP معاً — لعملية حسّاسة بلا تغيير حالة.
   *
   * يستعمله توليد رموز الاسترداد: من وصل إلى جهاز مفتوح لا يطبع لنفسه
   * مفاتيح دخول دائمة. ولا يقبل رمز استرداد بديلاً هنا عمداً — رمزٌ واحد
   * يولّد عشرة يجعل المجموعة أبدية.
   */
  async assertPasswordAndTotp(userId: string, password: string, totp: string): Promise<void> {
    const [row] = await this.db
      .select({ cred: adminCredentials, user: users })
      .from(adminCredentials)
      .innerJoin(users, eq(users.id, adminCredentials.userId))
      .where(eq(adminCredentials.userId, userId))
      .limit(1);
    if (!row) throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS' });

    if (!(await argon2.verify(row.user.passwordHash, password))) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS' });
    }
    if (!row.cred.totpEnabled || !row.cred.totpSecret) {
      throw new UnauthorizedException({ code: 'TOTP_NOT_ENABLED' });
    }
    await this.consumeTotp(userId, row.cred.totpSecret, totp, {
      method: 'admin_password_totp' as const,
    });
  }

  private async consumeTotp(
    userId: string,
    secret: string,
    token: string,
    event: AuthContext & { method: 'admin_password_totp' },
  ): Promise<void> {
    const step = verifyTotpStep(token, secret);
    if (step === null) {
      await this.events.record({ ...event, userId, outcome: 'totp_invalid' });
      throw new UnauthorizedException({ code: 'TOTP_INVALID' });
    }
    const consumed = await this.db
      .update(adminCredentials)
      .set({ lastTotpStep: step })
      .where(
        and(
          eq(adminCredentials.userId, userId),
          or(isNull(adminCredentials.lastTotpStep), lt(adminCredentials.lastTotpStep, step)),
        ),
      )
      .returning({ userId: adminCredentials.userId });
    if (consumed.length === 0) {
      // رمز صحيح لكنه مستعمل سلفاً — إعادة تشغيل مسروقة أو ضغطتان
      await this.events.record({ ...event, userId, outcome: 'totp_replayed' });
      throw new UnauthorizedException({ code: 'TOTP_ALREADY_USED' });
    }
  }
}
