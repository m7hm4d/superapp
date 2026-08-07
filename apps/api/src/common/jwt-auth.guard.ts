import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { UserStatus } from '@superapp/shared';
import { and, eq, gt, isNull } from 'drizzle-orm';
import { DB, DbClient } from '../db/drizzle.module';
import { refreshTokens, users } from '../db/schema';
import { ALLOWED_SCOPES_KEY, IS_PUBLIC_KEY } from './decorators';

export interface AccessTokenPayload {
  sub: string;
  role: string;
  phone: string;
  /** عائلة الجلسة — إبطالها يُبطل رمز الوصول فوراً لا بعد انتهائه */
  fid?: string;
  /** يوجد فقط في التوكنات المحدودة — غيابه يعني جلسة كاملة */
  scope?: string;
}

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
    @Inject(DB) private readonly db: DbClient,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const header: string | undefined = req.headers['authorization'];
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException({ code: 'NO_TOKEN' });

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException({ code: 'INVALID_TOKEN' });
    }

    // التوكن المحدود لا يفتح إلا المسارات التي تعلن قبول **نطاقه بالاسم**.
    // المقارنة بالقيمة لا بالوجود: توكن الخطوة الثانية وتوكن التسجيل كلاهما
    // يحمل `scope`، ولكلٍّ منهما مسارات مختلفة تماماً.
    if (payload.scope) {
      const allowed = this.reflector.getAllAndOverride<string[] | undefined>(ALLOWED_SCOPES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);
      if (!allowed?.includes(payload.scope)) {
        throw new UnauthorizedException({ code: 'TOKEN_SCOPE_FORBIDDEN' });
      }
    }

    // التوكنات المحدودة لا تحمل عائلة ولا تفتح مسارات عادية — يكفيها ما سبق
    if (!payload.scope) {
      const role = await this.assertLiveSession(payload);
      // الدور من القاعدة لا من التوكن: خفض الصلاحيات كان يظل بلا أثر حتى
      // ينتهي الرمز، لأن RolesGuard يقرأ ما نضعه هنا.
      req.user = { id: payload.sub, role, phone: payload.phone };
      return true;
    }

    req.user = { id: payload.sub, role: payload.role, phone: payload.phone };
    return true;
  }

  /**
   * يتحقق أن الجلسة ما زالت حيّة **الآن**، ويعيد الدور الحالي.
   *
   * التوقيع وحده كان كافياً، فترتّب عليه أن الخروج وإبطال الجلسة والحظر
   * وخفض الدور لا يمسّ REST حتى ينتهي رمز الوصول — نافذة تصل إلى خمس عشرة
   * دقيقة. وقد قِيس على بيئة التجربة: بعد `auth/logout` كان رمز التجديد
   * يعود 401 بينما رمز الوصول يفتح `auth/me` بـ200.
   *
   * استعلام واحد لكل طلب: الحارس المجاور `ApprovedGuard` يفعل مثله، والصحّة
   * هنا تسبق التوفير. وهو على مفتاح أساسي وفهرس عائلة.
   */
  private async assertLiveSession(payload: AccessTokenPayload): Promise<string> {
    // رمز بلا عائلة صدر قبل ربط الجلسات، فلا سبيل للتحقق منه — يُرفض.
    // والعميل يجدّد تلقائياً عند 401 فيحصل على رمز مربوط: لا يُفقد أحد جلسته.
    if (!payload.fid) {
      throw new UnauthorizedException({ code: 'SESSION_REVOKED' });
    }

    // استعلامان بسيطان لا استعلام فرعي مرتبط: drizzle يُصيّر مراجع الأعمدة
    // **غير مؤهَّلة**، فـ`users.id` داخل EXISTS صار `"id"` أي عمود الجدول
    // الفرعي نفسه — ارتباط مكسور لا يتحقق أبداً. أمسكته الاختبارات لأنه فشل
    // مغلقاً، ولو فشل مفتوحاً لمرّ بصمت. الوضوح هنا أوثق من التوفير.
    const [[account], [session]] = await Promise.all([
      this.db
        .select({ status: users.status, role: users.role })
        .from(users)
        .where(eq(users.id, payload.sub))
        .limit(1),
      this.db
        .select({ id: refreshTokens.id })
        .from(refreshTokens)
        .where(
          and(
            eq(refreshTokens.familyId, payload.fid),
            // العائلة تخصّ صاحب الرمز: بلا هذا يفتح fid عائلةَ غيره
            eq(refreshTokens.userId, payload.sub),
            isNull(refreshTokens.revokedAt),
            gt(refreshTokens.expiresAt, new Date()),
          ),
        )
        .limit(1),
    ]);

    // رسالة واحدة لكل الحالات: التمييز بينها يخبر المهاجم أي شرط سقط.
    if (!account || account.status !== UserStatus.ACTIVE || !session) {
      throw new UnauthorizedException({ code: 'SESSION_REVOKED' });
    }
    return account.role;
  }
}
