import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { DB, DbClient } from '../../db/drizzle.module';
import { pushTokens } from '../../db/schema';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';

export interface PushMessage {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * إرسال عبر Expo Push API مباشرة (بلا SDK). الفشل لا يكسر العملية —
 * الـ push تنبيه مساعد والحقيقة عبر REST/socket (الملف §10).
 */
@Injectable()
export class PushService {
  private readonly logger = new Logger(PushService.name);

  constructor(@Inject(DB) private readonly db: DbClient) {}

  async registerToken(userId: string, token: string, platform?: string) {
    await this.db
      .insert(pushTokens)
      .values({ userId, token, platform: platform ?? null })
      .onConflictDoUpdate({
        target: pushTokens.token,
        set: { userId, platform: platform ?? null, updatedAt: new Date() },
      });
    return { ok: true };
  }

  async removeToken(token: string) {
    await this.db.delete(pushTokens).where(eq(pushTokens.token, token));
    return { ok: true };
  }

  async sendToUsers(userIds: string[], message: PushMessage): Promise<void> {
    if (userIds.length === 0) return;
    try {
      const rows = await this.db
        .select({ token: pushTokens.token })
        .from(pushTokens)
        .where(inArray(pushTokens.userId, userIds));
      if (rows.length === 0) return;

      const payload = rows.map((r) => ({
        to: r.token,
        title: message.title,
        body: message.body,
        data: message.data ?? {},
        sound: 'default',
        priority: 'high',
      }));

      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        this.logger.warn(`expo push failed: ${res.status}`);
        return;
      }
      // إزالة التوكنات الميتة التي يعيدها Expo
      const body = (await res.json()) as { data?: { status: string; details?: { error?: string } }[] };
      const dead: string[] = [];
      body.data?.forEach((ticket, i) => {
        if (ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered') {
          const t = payload[i]?.to;
          if (t) dead.push(t);
        }
      });
      if (dead.length > 0) {
        await this.db.delete(pushTokens).where(inArray(pushTokens.token, dead));
      }
    } catch (err) {
      this.logger.warn({ err }, 'expo push error (ignored)');
    }
  }
}
