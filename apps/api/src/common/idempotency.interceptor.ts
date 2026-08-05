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
import { eq } from 'drizzle-orm';
import { Observable, concatMap, from, map, of, switchMap } from 'rxjs';
import { DB, DbClient } from '../db/drizzle.module';
import { idempotencyKeys } from '../db/schema';

/**
 * كل كتابة تحمل x-idempotency-key: إعادة الإرسال بنفس المفتاح ونفس الجسم
 * ترجع الاستجابة المخزنة بلا تنفيذ مكرر؛ نفس المفتاح بجسم مختلف = 409.
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

    const requestHash = createHash('sha256')
      .update(JSON.stringify(req.body ?? {}))
      .digest('hex');

    return from(
      this.db.select().from(idempotencyKeys).where(eq(idempotencyKeys.key, key)).limit(1),
    ).pipe(
      switchMap(([existing]) => {
        if (existing) {
          if (existing.requestHash !== requestHash) {
            throw new ConflictException({ code: 'IDEMPOTENCY_MISMATCH' });
          }
          if (existing.responseStatus != null) {
            res.status(existing.responseStatus);
            return of(existing.responseBody ? JSON.parse(existing.responseBody) : undefined);
          }
          // طلب سابق ما زال قيد المعالجة
          throw new ConflictException({ code: 'IDEMPOTENCY_IN_FLIGHT' });
        }
        return from(
          this.db
            .insert(idempotencyKeys)
            .values({
              key,
              userId: req.user?.id ?? null,
              method,
              path: req.originalUrl ?? req.url,
              requestHash,
            })
            .onConflictDoNothing(),
        ).pipe(
          switchMap(() =>
            next.handle().pipe(
              // استعلامات درزل كسولة — يجب انتظار التخزين قبل إصدار الاستجابة
              concatMap((body) =>
                from(
                  this.db
                    .update(idempotencyKeys)
                    .set({
                      responseStatus: res.statusCode ?? 200,
                      responseBody: JSON.stringify(body ?? null),
                    })
                    .where(eq(idempotencyKeys.key, key)),
                ).pipe(map(() => body)),
              ),
            ),
          ),
        );
      }),
    );
  }
}
