import { Inject, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { lt } from 'drizzle-orm';
import { DB, DbClient } from '../db/drizzle.module';
import { idempotencyKeys } from '../db/schema';

/** نافذة إعادة المحاولة فقط — لا استجابات مخزنة بلا أجل */
export const IDEMPOTENCY_RETENTION_MS = 24 * 3_600_000;

/** تنظيف دوري لمفاتيح idempotency المنتهية (يستفيد من idempotency_created_idx) */
@Injectable()
export class IdempotencyPurgeService {
  private readonly logger = new Logger(IdempotencyPurgeService.name);
  private running = false;

  constructor(@Inject(DB) private readonly db: DbClient) {}

  @Interval(3_600_000)
  async purgeExpired(): Promise<void> {
    if (this.running) return; // منع التداخل بين الدورات
    this.running = true;
    try {
      const cutoff = new Date(Date.now() - IDEMPOTENCY_RETENTION_MS);
      const deleted = await this.db
        .delete(idempotencyKeys)
        .where(lt(idempotencyKeys.createdAt, cutoff))
        .returning({ key: idempotencyKeys.key });
      if (deleted.length > 0) {
        this.logger.log(`purged ${deleted.length} expired idempotency keys`);
      }
    } finally {
      this.running = false;
    }
  }
}
