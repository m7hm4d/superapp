import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthTokens, AuthUser, Role, UserStatus } from '@superapp/shared';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server';
import { and, eq, lt } from 'drizzle-orm';
import { DB, DbClient } from '../../db/drizzle.module';
import { adminCredentials, adminPasskeys, users, webauthnChallenges } from '../../db/schema';
import { AuthEventsService, type AuthContext } from './auth-events.service';
import { TokenService } from './token.service';

/** التحدي قصير العمر وواحد الاستعمال — يُحذف فور التحقق */
const CHALLENGE_TTL_MS = 5 * 60_000;

export interface PasskeySummary {
  id: string;
  label: string;
  createdAt: Date;
  lastUsedAt: Date | null;
}

/**
 * مفاتيح المرور للإدارة (WebAuthn).
 *
 * مفتاح المرور عامل كامل بذاته: حيازة الجهاز + بصمة/رمز الجهاز، ومربوط
 * بالنطاق تشفيرياً فلا يُصطاد كما يُصطاد رمز TOTP. لذلك الدخول به وحده
 * يصدر جلسة كاملة، ويبقى TOTP مساراً بديلاً لا يُحذف.
 */
@Injectable()
export class PasskeyService {
  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly config: ConfigService,
    private readonly tokens: TokenService,
    private readonly events: AuthEventsService,
  ) {}

  private get rpID(): string {
    return this.config.getOrThrow<string>('WEBAUTHN_RP_ID');
  }

  private get origins(): string[] {
    return this.config
      .getOrThrow<string>('WEBAUTHN_ORIGINS')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  // ─────────────────────────────── التسجيل ───────────────────────────────

  async registrationOptions(userId: string) {
    const admin = await this.requireAdmin(userId);
    const existing = await this.db
      .select()
      .from(adminPasskeys)
      .where(eq(adminPasskeys.userId, userId));

    const options = await generateRegistrationOptions({
      rpName: this.config.getOrThrow<string>('WEBAUTHN_RP_NAME'),
      rpID: this.rpID,
      userName: admin.email,
      userDisplayName: admin.fullName,
      // معرّف ثابت للمستخدم كي يستبدل المفتاح القديم على الجهاز نفسه
      userID: new TextEncoder().encode(userId),
      attestationType: 'none',
      // منع تسجيل الجهاز نفسه مرتين
      excludeCredentials: existing.map((c) => ({ id: c.credentialId })),
      authenticatorSelection: {
        residentKey: 'preferred', // مفتاح قابل للاكتشاف: دخول بلا كتابة بريد
        userVerification: 'preferred',
      },
    });

    await this.storeChallenge(options.challenge, 'register', userId);
    return options;
  }

  async verifyRegistration(
    userId: string,
    response: RegistrationResponseJSON,
    label: string,
    ctx: AuthContext = {},
  ): Promise<{ id: string; label: string }> {
    await this.requireAdmin(userId);
    const challenge = await this.consumeChallenge(
      this.challengeFromClientData(response.response.clientDataJSON),
      'register',
      userId,
    );

    const verification = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: this.origins,
      expectedRPID: this.rpID,
      requireUserVerification: false,
    });
    if (!verification.verified || !verification.registrationInfo) {
      throw new UnauthorizedException({ code: 'PASSKEY_INVALID' });
    }

    const { credential } = verification.registrationInfo;
    const [saved] = await this.db
      .insert(adminPasskeys)
      .values({
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter,
        transports: response.response.transports
          ? JSON.stringify(response.response.transports)
          : null,
        label: label.trim().slice(0, 60) || 'مفتاح مرور',
      })
      .returning({ id: adminPasskeys.id, label: adminPasskeys.label });

    await this.events.record({
      ...ctx,
      userId,
      method: 'admin_passkey',
      outcome: 'enrollment_completed',
    });
    return saved;
  }

  // ─────────────────────────────── الدخول ───────────────────────────────

  /** بلا بريد: المفتاح قابل للاكتشاف فيختاره الجهاز — دخول بلمسة واحدة */
  async authenticationOptions() {
    const options = await generateAuthenticationOptions({
      rpID: this.rpID,
      userVerification: 'preferred',
    });
    await this.storeChallenge(options.challenge, 'login', null);
    return options;
  }

  async verifyAuthentication(
    response: AuthenticationResponseJSON,
    ctx: AuthContext = {},
  ): Promise<{ user: AuthUser; tokens: AuthTokens }> {
    const event = { ...ctx, method: 'admin_passkey' as const };
    const challenge = await this.consumeChallenge(
      this.challengeFromClientData(response.response.clientDataJSON),
      'login',
      null,
    );

    const [row] = await this.db
      .select({ passkey: adminPasskeys, user: users })
      .from(adminPasskeys)
      .innerJoin(users, eq(users.id, adminPasskeys.userId))
      .where(eq(adminPasskeys.credentialId, response.id))
      .limit(1);

    if (!row || row.user.role !== Role.ADMIN) {
      await this.events.record({ ...event, outcome: 'unknown_identifier' });
      throw new UnauthorizedException({ code: 'PASSKEY_UNKNOWN' });
    }
    if (row.user.status === UserStatus.BLOCKED) {
      await this.events.record({ ...event, userId: row.user.id, outcome: 'blocked' });
      throw new ForbiddenException({ code: 'BLOCKED' });
    }

    const verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge,
      expectedOrigin: this.origins,
      expectedRPID: this.rpID,
      requireUserVerification: false,
      credential: {
        id: row.passkey.credentialId,
        publicKey: new Uint8Array(Buffer.from(row.passkey.publicKey, 'base64url')),
        counter: row.passkey.counter,
        transports: row.passkey.transports ? JSON.parse(row.passkey.transports) : undefined,
      },
    }).catch(() => null);

    if (!verification?.verified) {
      await this.events.record({ ...event, userId: row.user.id, outcome: 'invalid_credentials' });
      throw new UnauthorizedException({ code: 'PASSKEY_INVALID' });
    }

    // عدّاد المصادِق يكشف نسخ المفتاح؛ بعض المفاتيح المتزامنة تُبقيه صفراً
    await this.db
      .update(adminPasskeys)
      .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() })
      .where(eq(adminPasskeys.id, row.passkey.id));

    const tokens = await this.tokens.issuePairWithFamily(row.user);
    await this.events.record({
      ...event,
      userId: row.user.id,
      outcome: 'success',
      sessionFamilyId: tokens.familyId,
    });
    return {
      user: {
        id: row.user.id,
        phone: row.user.phone,
        fullName: row.user.fullName,
        role: row.user.role,
      },
      tokens,
    };
  }

  // ─────────────────────────────── الإدارة ───────────────────────────────

  async list(userId: string): Promise<PasskeySummary[]> {
    return this.db
      .select({
        id: adminPasskeys.id,
        label: adminPasskeys.label,
        createdAt: adminPasskeys.createdAt,
        lastUsedAt: adminPasskeys.lastUsedAt,
      })
      .from(adminPasskeys)
      .where(eq(adminPasskeys.userId, userId));
  }

  /**
   * حذف مفتاح. يُرفض حذف آخر مفتاح إن لم يكن TOTP مفعّلاً — وإلا أقفل
   * الأدمن حسابه بنفسه، وهو ما لا مخرج منه إلا بتعديل قاعدة البيانات.
   */
  async remove(userId: string, passkeyId: string): Promise<{ ok: true }> {
    const keys = await this.db
      .select({ id: adminPasskeys.id })
      .from(adminPasskeys)
      .where(eq(adminPasskeys.userId, userId));
    if (!keys.some((k) => k.id === passkeyId)) {
      throw new NotFoundException({ code: 'PASSKEY_NOT_FOUND' });
    }
    if (keys.length === 1) {
      const [cred] = await this.db
        .select({ totpEnabled: adminCredentials.totpEnabled })
        .from(adminCredentials)
        .where(eq(adminCredentials.userId, userId))
        .limit(1);
      if (!cred?.totpEnabled) {
        throw new ForbiddenException({ code: 'LAST_FACTOR' });
      }
    }
    await this.db
      .delete(adminPasskeys)
      .where(and(eq(adminPasskeys.id, passkeyId), eq(adminPasskeys.userId, userId)));
    return { ok: true };
  }

  async countFor(userId: string): Promise<number> {
    const rows = await this.db
      .select({ id: adminPasskeys.id })
      .from(adminPasskeys)
      .where(eq(adminPasskeys.userId, userId));
    return rows.length;
  }

  // ─────────────────────────── مساعدات داخلية ───────────────────────────

  private async requireAdmin(userId: string) {
    const [row] = await this.db
      .select({ email: adminCredentials.email, fullName: users.fullName, role: users.role })
      .from(adminCredentials)
      .innerJoin(users, eq(users.id, adminCredentials.userId))
      .where(eq(adminCredentials.userId, userId))
      .limit(1);
    if (!row || row.role !== Role.ADMIN) {
      throw new ForbiddenException({ code: 'NO_ADMIN_CREDENTIALS' });
    }
    return row;
  }

  private challengeFromClientData(clientDataJSON: string): string {
    try {
      const parsed = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8'));
      const challenge: unknown = parsed?.challenge;
      if (typeof challenge !== 'string') throw new Error('no challenge');
      return challenge;
    } catch {
      throw new UnauthorizedException({ code: 'PASSKEY_INVALID' });
    }
  }

  private async storeChallenge(
    challenge: string,
    purpose: 'register' | 'login',
    userId: string | null,
  ): Promise<void> {
    // تنظيف كسول للمنتهية — الجدول يبقى صغيراً بلا مهمة دورية
    await this.db.delete(webauthnChallenges).where(lt(webauthnChallenges.expiresAt, new Date()));
    await this.db.insert(webauthnChallenges).values({
      challenge,
      purpose,
      userId,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    });
  }

  /** الحذف المشروط هو القفل: تحدٍّ واحد الاستعمال حتى تحت التزامن */
  private async consumeChallenge(
    challenge: string,
    purpose: 'register' | 'login',
    userId: string | null,
  ): Promise<string> {
    const deleted = await this.db
      .delete(webauthnChallenges)
      .where(
        and(
          eq(webauthnChallenges.challenge, challenge),
          eq(webauthnChallenges.purpose, purpose),
          ...(userId ? [eq(webauthnChallenges.userId, userId)] : []),
        ),
      )
      .returning({ challenge: webauthnChallenges.challenge, expiresAt: webauthnChallenges.expiresAt });

    const row = deleted[0];
    if (!row || row.expiresAt.getTime() < Date.now()) {
      throw new UnauthorizedException({ code: 'PASSKEY_CHALLENGE_EXPIRED' });
    }
    return row.challenge;
  }
}
