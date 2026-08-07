import { Inject, Injectable } from '@nestjs/common';
import { inArray } from 'drizzle-orm';
import { DB, DbClient } from '../../db/drizzle.module';
import { users } from '../../db/schema';

/**
 * منفذ القراءة إلى الحسابات.
 *
 * `users` تلمسه أربع وحدات ولا تملكه: كلها تريد الاسم للعرض. فبدل أن تضمّ
 * كلٌّ منها الجدول، تنادي هذا.
 *
 * الاسم وحده لا الصف: تسريب حالة الحساب أو دوره أو هاتفه عبر الحدّ يجعل كل
 * وحدة قادرة على اتخاذ قرار تفويض بنفسها — وهو ما يحرسه `JwtAuthGuard`
 * في موضع واحد.
 */
@Injectable()
export class UserDirectoryService {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  /** أسماء دفعة واحدة مفهرسة بالمعرّف — بديل الانضمام لا نداء لكل صف */
  async namesFor(userIds: readonly string[]): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const rows = await this.db
      .select({ id: users.id, fullName: users.fullName })
      .from(users)
      .where(inArray(users.id, [...new Set(userIds)]));
    return new Map(rows.map((row) => [row.id, row.fullName]));
  }
}
