import {
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
import { TokenService } from './token.service';
import { totp, verifyTotpStep } from './totp';

/** نطاق توكن التسجيل: لا يفتح إلا مساري إعداد/تفعيل TOTP */
export const TOTP_ENROLLMENT_SCOPE = 'admin_totp_enrollment';
/** مهلة قصيرة — التسجيل يتم في جلسة واحدة أمام تطبيق المصادقة */
const ENROLLMENT_TTL_SEC = 15 * 60;

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

export type AdminLoginResult = AdminSession | AdminEnrollmentRequired;

/**
 * دخول الإدارة مستقل عن تدفق الهاتف: بريد + كلمة مرور قوية + TOTP (الملف §3).
 * TOTP إلزامي: من لم يسجّل بعدُ لا يحصل على جلسة إدارية، بل على توكن تسجيل
 * محدود يفتح مساري الإعداد والتفعيل فقط.
 */
@Injectable()
export class AdminAuthService {
  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly tokens: TokenService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async login(input: {
    email: string;
    password: string;
    totp?: string;
  }): Promise<AdminLoginResult> {
    const [row] = await this.db
      .select({ cred: adminCredentials, user: users })
      .from(adminCredentials)
      .innerJoin(users, eq(users.id, adminCredentials.userId))
      .where(eq(adminCredentials.email, input.email.toLowerCase().trim()))
      .limit(1);

    if (!row || row.user.role !== Role.ADMIN) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS' });
    }
    if (row.user.status === UserStatus.BLOCKED) {
      throw new ForbiddenException({ code: 'BLOCKED' });
    }
    const ok = await argon2.verify(row.user.passwordHash, input.password);
    if (!ok) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS' });
    }

    // TOTP إلزامي — لا جلسة إدارية بعامل واحد
    if (!row.cred.totpEnabled || !row.cred.totpSecret) {
      return {
        status: 'totp_enrollment_required',
        enrollmentToken: await this.issueEnrollmentToken(row.user.id),
        expiresInSec: ENROLLMENT_TTL_SEC,
        email: row.cred.email,
      };
    }

    if (!input.totp) {
      throw new UnauthorizedException({ code: 'TOTP_REQUIRED' });
    }
    await this.consumeTotp(row.user.id, row.cred.totpSecret, input.totp);

    const tokens = await this.tokens.issuePair(row.user);
    return {
      status: 'ok',
      user: {
        id: row.user.id,
        phone: row.user.phone,
        fullName: row.user.fullName,
        role: row.user.role as Role,
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
  async enableTotp(userId: string, token: string): Promise<AdminSession> {
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
    const tokens = await this.tokens.issuePair(user);
    return {
      status: 'ok',
      user: {
        id: user.id,
        phone: user.phone,
        fullName: user.fullName,
        role: user.role as Role,
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
  private async consumeTotp(userId: string, secret: string, token: string): Promise<void> {
    const step = verifyTotpStep(token, secret);
    if (step === null) {
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
      throw new UnauthorizedException({ code: 'TOTP_ALREADY_USED' });
    }
  }
}
