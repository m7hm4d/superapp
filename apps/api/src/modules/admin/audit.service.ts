import { Inject, Injectable } from '@nestjs/common';
import { DB, type DbClient } from '../../db/drizzle.module';
import { adminAuditLog } from '../../db/schema';

/** طلب Express بعد nestjs-pino: يحمل معرّف الطلب للتتبع في سجل التدقيق */
export interface RequestWithId {
  id?: string;
}

/**
 * كل فعل إداري يُسجَّل هنا مع السبب (الملف §7).
 * تُصدَّر من AdminModule ليستخدمها أي إجراء إداري في وحدات أخرى.
 */
@Injectable()
export class AuditService {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  async log(
    actorUserId: string,
    action: string,
    targetType: string,
    targetId: string | null,
    payload?: unknown,
    reason?: string,
    requestId?: string,
  ): Promise<void> {
    await this.db.insert(adminAuditLog).values({
      actorUserId,
      action,
      targetType,
      targetId,
      payload: payload === undefined ? null : JSON.stringify(payload),
      reason: reason ?? null,
      requestId: requestId ?? null,
    });
  }
}
