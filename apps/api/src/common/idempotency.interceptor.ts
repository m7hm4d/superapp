import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Inject,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { IDEMPOTENCY_HEADER } from '@superapp/shared';
import { createHash } from 'node:crypto';
import { and, eq, isNull, lt } from 'drizzle-orm';
import { defer, lastValueFrom, Observable } from 'rxjs';
import { DB, DbClient } from '../db/drizzle.module';
import { idempotencyKeys } from '../db/schema';

/** ادعاء pending أقدم من هذا يُعد متروكاً (انهيار العملية قبل التخزين أو الفك) ويجوز الاستيلاء عليه */
const STALE_CLAIM_MS = 5 * 60_000;

/** مسارات المصادقة تُستثنى كلياً: استجاباتها تحمل توكنات وأسرار TOTP ولا يجوز تخزينها أو إعادتها من الكاش */
const AUTH_SEGMENT = /(?:^|\/)auth(?:\/|$)/;

interface Claim {
  key: string;
  userId: string | null;
  method: string;
  path: string;
  requestHash: string;
}

/**
 * كل كتابة تحمل x-idempotency-key: إعادة الإرسال بنفس المفتاح ونفس الجسم
 * ترجع الاستجابة المخزنة بلا تنفيذ مكرر؛ نفس المفتاح بجسم مختلف = 409.
 *
 * الذرية: إدراج الصف الفريد هو القفل — من ينجح إدراجه ينفّذ، ومن يخفق
 * يقرأ حالة المالك (replay / in-flight / mismatch). لا نافذة select-ثم-insert.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const method: string = req.method;
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return next.handle();

    const key: string | undefined = req.headers[IDEMPOTENCY_HEADER];
    if (!key) return next.handle(); // اختياري في الطيار؛ التطبيقات ترسله دائماً

    const path = String(req.originalUrl ?? req.url).split('?')[0];
    if (AUTH_SEGMENT.test(path)) return next.handle();

    const requestHash = createHash('sha256')
      .update(JSON.stringify(req.body ?? {}))
      .digest('hex');

    const claim: Claim = {
      key,
      userId: req.user?.id ?? null,
      method,
      path,
      requestHash,
    };
    return defer(() => this.execute(next, res, claim));
  }

  private async execute(
    next: CallHandler,
    res: { statusCode?: number; status: (code: number) => unknown },
    claim: Claim,
    attemptsLeft = 1,
  ): Promise<unknown> {
    const [claimed] = await this.db
      .insert(idempotencyKeys)
      .values(claim)
      .onConflictDoNothing()
      .returning({ key: idempotencyKeys.key });

    if (claimed) {
      let body: unknown;
      try {
        body = await lastValueFrom(next.handle(), { defaultValue: undefined });
      } catch (err) {
        // الفشل لا يُخزَّن: يُفك الادعاء كي تستطيع إعادة المحاولة التنفيذ فعلاً
        await this.db.delete(idempotencyKeys).where(eq(idempotencyKeys.key, claim.key));
        throw err;
      }
      // استعلامات درزل كسولة — يجب انتظار التخزين قبل إصدار الاستجابة
      await this.db
        .update(idempotencyKeys)
        .set({
          responseStatus: res.statusCode ?? 200,
          responseBody: JSON.stringify(body ?? null),
        })
        .where(eq(idempotencyKeys.key, claim.key));
      return body;
    }

    const [existing] = await this.db
      .select()
      .from(idempotencyKeys)
      .where(eq(idempotencyKeys.key, claim.key))
      .limit(1);

    if (!existing) {
      // المالك فشل وحرّر المفتاح بين إدراجنا وقراءتنا — محاولة أخيرة واحدة
      if (attemptsLeft > 0) return this.execute(next, res, claim, attemptsLeft - 1);
      throw new ConflictException({ code: 'IDEMPOTENCY_IN_FLIGHT' });
    }

    if (existing.requestHash !== claim.requestHash || (existing.userId ?? null) !== claim.userId) {
      // جسم مختلف أو مستخدم آخر — لا تنفيذ ولا كشف للاستجابة المخزنة
      throw new ConflictException({ code: 'IDEMPOTENCY_MISMATCH' });
    }

    if (existing.responseStatus != null) {
      res.status(existing.responseStatus);
      return existing.responseBody ? JSON.parse(existing.responseBody) : undefined;
    }

    const staleCutoff = new Date(Date.now() - STALE_CLAIM_MS);
    if (existing.createdAt <= staleCutoff && attemptsLeft > 0) {
      await this.db
        .delete(idempotencyKeys)
        .where(
          and(
            eq(idempotencyKeys.key, claim.key),
            isNull(idempotencyKeys.responseStatus),
            lt(idempotencyKeys.createdAt, staleCutoff),
          ),
        );
      return this.execute(next, res, claim, attemptsLeft - 1);
    }

    // الطلب الأصلي ما زال قيد المعالجة
    throw new ConflictException({ code: 'IDEMPOTENCY_IN_FLIGHT' });
  }
}
