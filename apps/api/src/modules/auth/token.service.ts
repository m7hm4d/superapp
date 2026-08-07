import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import { AuthTokens, UserStatus } from '@superapp/shared';
import { and, eq, isNull } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { DB, DbClient } from '../../db/drizzle.module';
import { refreshTokens, users } from '../../db/schema';
import { AuthEventsService, type AuthContext } from './auth-events.service';

type UserRow = typeof users.$inferSelect;
type Tx = Parameters<Parameters<DbClient['transaction']>[0]>[0];
type DbExecutor = DbClient | Tx;

interface RefreshTokenPayload {
  sub: string;
  fid: string;
  jti: string;
}

interface IssuedPair extends AuthTokens {
  refreshRowId: string;
}

/** يميّز فشل السباق داخل معاملة التدوير عن الأخطاء الأخرى */
class RotationConflictError extends Error {}

/** '15m' / '12h' / '30d' / '45s' / '500' (ميلي ثانية) => ميلي ثانية */
export function parseTtlMs(ttl: string): number {
  const m = /^(\d+)\s*(ms|s|m|h|d)?$/.exec(ttl.trim());
  if (!m) throw new Error(`Invalid TTL: ${ttl}`);
  const n = Number(m[1]);
  switch (m[2]) {
    case 's':
      return n * 1_000;
    case 'm':
      return n * 60_000;
    case 'h':
      return n * 3_600_000;
    case 'd':
      return n * 86_400_000;
    default:
      return n;
  }
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    @Inject(DB) private readonly db: DbClient,
    private readonly events: AuthEventsService,
    private readonly emitter: EventEmitter2,
  ) {}

  /** زوج جديد بسلالة (family) جديدة — عند التسجيل أو الدخول */
  async issuePair(user: UserRow): Promise<AuthTokens> {
    const pair = await this.issuePairWithFamily(user);
    return { accessToken: pair.accessToken, refreshToken: pair.refreshToken };
  }

  /** مثل issuePair لكن يكشف معرّف السلالة — يربط سجل المصادقة بالجلسة الناتجة */
  async issuePairWithFamily(user: UserRow): Promise<AuthTokens & { familyId: string }> {
    const familyId = randomUUID();
    const pair = await this.createPair(user, familyId, this.db);
    return { accessToken: pair.accessToken, refreshToken: pair.refreshToken, familyId };
  }

  /**
   * تدوير refresh token: إعادة استخدام رمز مُبطَل/مجهول = اختراق محتمل،
   * فتُبطَل السلالة كاملة ويُرفض الطلب بـ REFRESH_REUSE.
   */
  async rotate(refreshToken: string): Promise<{ tokens: AuthTokens }> {
    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshTokenPayload>(refreshToken, {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      });
    } catch {
      throw new UnauthorizedException({ code: 'INVALID_REFRESH' });
    }

    const [row] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, sha256(refreshToken)))
      .limit(1);

    if (!row || row.revokedAt) {
      const familyId = row?.familyId ?? payload.fid;
      if (familyId) await this.revokeFamily(familyId);
      await this.events.record({
        userId: row?.userId ?? payload.sub ?? null,
        method: 'refresh',
        outcome: 'refresh_reuse',
        sessionFamilyId: familyId ?? null,
      });
      throw new UnauthorizedException({ code: 'REFRESH_REUSE' });
    }

    if (row.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException({ code: 'REFRESH_EXPIRED' });
    }

    const [user] = await this.db.select().from(users).where(eq(users.id, row.userId)).limit(1);
    if (!user) throw new UnauthorizedException({ code: 'INVALID_REFRESH' });
    if (user.status === UserStatus.BLOCKED) {
      await this.revokeFamily(row.familyId);
      throw new ForbiddenException({ code: 'BLOCKED' });
    }

    // تغيّر الدور منذ إصدار العائلة يُنهي الجلسة هنا أيضاً.
    //
    // هذا المسار **عام** لا يمرّ بحارس المصادقة، فكان يصدر رمزاً بالدور
    // الحالي: حساب زبون رُقّي في القاعدة يحصل على رمز أدمن كامل بلا مصادقة
    // إدارة ولا عامل ثانٍ. قِيس على بيئة التجربة — وفتح مساراً إدارياً بـ200.
    //
    // المقارنة بدور **إصدار العائلة** لا بما في الرمز: الرمز مبهم لنا هنا،
    // والعمود لا يُزوَّر.
    if (row.issuedRole !== user.role) {
      await this.revokeAllForUser(user.id, 'role changed');
      throw new UnauthorizedException({ code: 'SESSION_REVOKED' });
    }

    try {
      const pair = await this.db.transaction(async (tx) => {
        const revoked = await tx
          .update(refreshTokens)
          .set({ revokedAt: new Date() })
          .where(and(eq(refreshTokens.id, row.id), isNull(refreshTokens.revokedAt)))
          .returning({ id: refreshTokens.id });
        if (revoked.length === 0) throw new RotationConflictError();

        const created = await this.createPair(user, row.familyId, tx);
        await tx
          .update(refreshTokens)
          .set({ replacedById: created.refreshRowId })
          .where(eq(refreshTokens.id, row.id));
        return created;
      });
      return { tokens: { accessToken: pair.accessToken, refreshToken: pair.refreshToken } };
    } catch (e) {
      if (e instanceof RotationConflictError) {
        await this.revokeFamily(row.familyId);
        throw new UnauthorizedException({ code: 'REFRESH_REUSE' });
      }
      throw e;
    }
  }

  /** خروج: إبطال سلالة الرمز المقدَّم إن كان يخص المستخدم نفسه — عملية idempotent */
  async logout(
    userId: string,
    refreshToken: string,
    ctx: AuthContext = {},
  ): Promise<{ ok: true }> {
    const [row] = await this.db
      .select({ familyId: refreshTokens.familyId, userId: refreshTokens.userId })
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, sha256(refreshToken)))
      .limit(1);
    if (row && row.userId === userId) {
      await this.revokeFamily(row.familyId);
      await this.events.record({
        ...ctx,
        userId,
        method: 'logout',
        outcome: 'logout',
        sessionFamilyId: row.familyId,
      });
    }
    return { ok: true };
  }

  /**
   * يُبطل كل جلسات المستخدم — لتغيّر الدور وما شابهه ممّا يخصّ الحساب لا
   * جهازاً بعينه. يبثّ لكل عائلة كي تُقطع اتصالاتها القائمة.
   */
  async revokeAllForUser(userId: string, reason: string): Promise<number> {
    const revoked = await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)))
      .returning({ familyId: refreshTokens.familyId });

    for (const familyId of new Set(revoked.map((r) => r.familyId))) {
      this.emitter.emit('session.revoked', { userId, familyId, reason });
    }
    return revoked.length;
  }

  async revokeFamily(familyId: string): Promise<void> {
    const revoked = await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.familyId, familyId), isNull(refreshTokens.revokedAt)))
      .returning({ userId: refreshTokens.userId });

    // نقطة الاختناق الوحيدة للإبطال: يمرّ بها الخروج وإبطال اللوحة وكشف
    // إعادة الاستعمال. إبطال رمز التحديث كان يقطع REST ولا يمسّ الـsocket،
    // فيبقى اتصال أدمن في غرفة الإدارة يستقبل أحداث الطلبات والمال.
    const userId = revoked[0]?.userId;
    if (userId) this.emitter.emit('session.revoked', { userId, familyId });
  }

  private async createPair(
    user: UserRow,
    familyId: string,
    executor: DbExecutor,
  ): Promise<IssuedPair> {
    const accessTtl = this.config.getOrThrow<string>('JWT_ACCESS_TTL');
    const refreshTtl = this.config.getOrThrow<string>('JWT_REFRESH_TTL');

    const accessToken = await this.jwt.signAsync(
      // ‏fid يربط الاتصال بعائلة جلسته، فيُقطع socket الجلسة المُبطَلة وحدها
      // دون بقية أجهزة المستخدم. التوكنات القديمة بلا fid تُقطع مع أي إبطال
      // يخص صاحبها — فشل إلى الجانب الآمن.
      { sub: user.id, role: user.role, phone: user.phone, fid: familyId },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: accessTtl as JwtSignOptions['expiresIn'],
      },
    );

    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, fid: familyId, jti: randomUUID() } satisfies RefreshTokenPayload,
      {
        secret: this.config.getOrThrow<string>('JWT_REFRESH_SECRET'),
        expiresIn: refreshTtl as JwtSignOptions['expiresIn'],
      },
    );

    const [inserted] = await executor
      .insert(refreshTokens)
      .values({
        // دور الإصدار يُثبَّت مع العائلة لا يُقرأ من الحساب عند كل تدوير
        issuedRole: user.role,
        userId: user.id,
        tokenHash: sha256(refreshToken),
        familyId,
        expiresAt: new Date(Date.now() + parseTtlMs(refreshTtl)),
      })
      .returning({ id: refreshTokens.id });

    return { accessToken, refreshToken, refreshRowId: inserted.id };
  }
}
