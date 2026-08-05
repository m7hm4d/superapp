import { Controller, Get, Inject } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import { Public } from '../../common/decorators';
import { DB, type DbClient } from '../../db/drizzle.module';
import { cities } from '../../db/schema';
import { FlagsService } from './flags.service';

/**
 * GET /api/v1/config — نقطة إقلاع التطبيقات (عميل/بائع/سائق):
 * أعلام الميزات + إعدادات المدينة النشطة الأولى.
 */
@Controller('config')
export class ConfigController {
  constructor(
    @Inject(DB) private readonly db: DbClient,
    private readonly flagsService: FlagsService,
  ) {}

  @Public()
  @Get()
  async getConfig() {
    const [flagRows, cityRows] = await Promise.all([
      this.flagsService.getAll(),
      this.db
        .select()
        .from(cities)
        .where(eq(cities.isActive, true))
        .orderBy(asc(cities.createdAt))
        .limit(1),
    ]);

    const flags: Record<string, { enabled: boolean; value: unknown }> = {};
    for (const f of flagRows) {
      flags[f.key] = { enabled: f.enabled, value: f.value };
    }

    const city = cityRows[0];
    return {
      flags,
      city: city
        ? {
            id: city.id,
            nameAr: city.nameAr,
            centerLat: city.center.lat,
            centerLng: city.center.lng,
            serviceRadiusKm: city.serviceRadiusKm,
            visibilityRadiusKm: city.visibilityRadiusKm,
            deliveryFeeIqd: city.deliveryFeeIqd,
          }
        : null,
    };
  }
}
