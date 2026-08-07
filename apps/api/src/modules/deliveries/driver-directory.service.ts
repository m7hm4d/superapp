import { Injectable } from '@nestjs/common';
import { eq, inArray } from 'drizzle-orm';
import { Inject } from '@nestjs/common';
import { DB, DbClient } from '../../db/drizzle.module';
import { driverProfiles } from '../../db/schema';
import { UserDirectoryService } from '../auth/user-directory.service';

/** ما تحتاجه الوحدات الأخرى من ملف السائق */
export interface DriverSummary {
  id: string;
  userId: string;
  fullName: string;
}

/**
 * منفذ القراءة إلى ملفات السائقين.
 *
 * `driverProfiles` تلمسه خمس وحدات ولا تملكه، وأكثر ما تريده منه اسم السائق
 * — وهو ليس فيه أصلاً بل في `users`.
 *
 * فالاسم يأتي عبر منفذ `auth` لا بانضمام إلى جدوله: `deliveries` لا تملك
 * `users` أيضاً. والتبعية هنا صريحة ومقصودة — هكذا يظهر شكل الاعتماد بدل
 * أن يختفي داخل `innerJoin`.
 */
@Injectable()
export class DriverDirectoryService {
  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly usersDirectory: UserDirectoryService,
  ) {}

  /** ملخّص بحساب صاحبه — أو null إن لم يكن للحساب ملف سائق */
  async summaryForUser(userId: string): Promise<DriverSummary | null> {
    const [row] = await this.db
      .select({ id: driverProfiles.id, userId: driverProfiles.userId })
      .from(driverProfiles)
      .where(eq(driverProfiles.userId, userId))
      .limit(1);
    if (!row) return null;
    const names = await this.usersDirectory.namesFor([row.userId]);
    return { ...row, fullName: names.get(row.userId) ?? '' };
  }

  /** ملخّص بمعرّف الملف — أو null إن لم يوجد */
  async summaryFor(driverProfileId: string): Promise<DriverSummary | null> {
    return (await this.summariesFor([driverProfileId])).get(driverProfileId) ?? null;
  }

  /**
   * ملخّصات دفعة واحدة مفهرسة بمعرّف الملف.
   *
   * استعلامان محدودان — واحد للملفات وواحد للأسماء — لا نداء لكل صف.
   */
  async summariesFor(driverProfileIds: readonly string[]): Promise<Map<string, DriverSummary>> {
    if (driverProfileIds.length === 0) return new Map();
    const rows = await this.db
      .select({ id: driverProfiles.id, userId: driverProfiles.userId })
      .from(driverProfiles)
      .where(inArray(driverProfiles.id, [...new Set(driverProfileIds)]));
    const names = await this.usersDirectory.namesFor(rows.map((r) => r.userId));
    return new Map(rows.map((r) => [r.id, { ...r, fullName: names.get(r.userId) ?? '' }]));
  }
}
