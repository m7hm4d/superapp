import { Inject, Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { eq } from 'drizzle-orm';
import { DB, type DbClient } from '../../db/drizzle.module';
import { featureFlags } from '../../db/schema';

export interface FlagView {
  key: string;
  enabled: boolean;
  /** JSON مفكوك من عمود value النصي؛ null إن غاب أو تعذّر التحليل */
  value: unknown;
}

export interface UpdateFlagPatch {
  enabled?: boolean;
  value?: unknown;
}

@Injectable()
export class FlagsService {
  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly emitter: EventEmitter2,
  ) {}

  private parseValue(raw: string | null): unknown {
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      return null;
    }
  }

  async getAll(): Promise<FlagView[]> {
    const rows = await this.db.select().from(featureFlags).orderBy(featureFlags.key);
    return rows.map((r) => ({
      key: r.key,
      enabled: r.enabled,
      value: this.parseValue(r.value),
    }));
  }

  async isEnabled(key: string): Promise<boolean> {
    const rows = await this.db
      .select({ enabled: featureFlags.enabled })
      .from(featureFlags)
      .where(eq(featureFlags.key, key))
      .limit(1);
    return rows[0]?.enabled ?? false;
  }

  async getValue<T>(key: string): Promise<T | null> {
    const rows = await this.db
      .select({ value: featureFlags.value })
      .from(featureFlags)
      .where(eq(featureFlags.key, key))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.parseValue(row.value) as T | null;
  }

  /** Upsert للعلم + بث 'config.updated' حتى تعيد التطبيقات تحميل الإعدادات */
  async update(key: string, patch: UpdateFlagPatch, actorUserId: string): Promise<FlagView> {
    const now = new Date();
    const serialized =
      patch.value === undefined || patch.value === null ? null : JSON.stringify(patch.value);

    const set: Partial<typeof featureFlags.$inferInsert> = {
      updatedAt: now,
      updatedBy: actorUserId,
    };
    if (patch.enabled !== undefined) set.enabled = patch.enabled;
    if (patch.value !== undefined) set.value = serialized;

    const rows = await this.db
      .insert(featureFlags)
      .values({
        key,
        enabled: patch.enabled ?? false,
        value: serialized,
        updatedAt: now,
        updatedBy: actorUserId,
      })
      .onConflictDoUpdate({ target: featureFlags.key, set })
      .returning();

    const row = rows[0];
    this.emitter.emit('config.updated', { keys: [key] });
    return { key: row.key, enabled: row.enabled, value: this.parseValue(row.value) };
  }
}
