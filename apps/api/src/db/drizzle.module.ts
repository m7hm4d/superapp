import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export const DB = Symbol('DB');
export const PIN_GUARD_DB = Symbol('PIN_GUARD_DB');
export type DbClient = NodePgDatabase<typeof schema>;

@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [ConfigService],
      useFactory: (config: ConfigService): DbClient => {
        const pool = new Pool({ connectionString: config.getOrThrow<string>('DATABASE_URL') });
        return drizzle(pool, { schema });
      },
    },
    {
      /**
       * مسبح مستقل لحارس PIN — ليس ترفاً بل شرط ألّا تتجمّد الواجهة.
       *
       * الحارس يُستدعى **داخل** معاملات المُستدعي (confirmPickup وتأكيد
       * التسوية)، فلو طلب اتصاله من المسبح نفسه لاحتجزت المعاملات الخارجية
       * كل الاتصالات وانتظر كلٌّ منها اتصالاً لن يتحرّر: جمود كامل لا
       * لهذه الطلبات وحدها بل للخدمة كلها. عشر معاملات متزامنة تكفي
       * (‏max الافتراضي في pg عشرة) — واختبار «تداخل الحارس لا يجمّد
       * المسبح» يمسك أي عودة إلى المسبح المشترك.
       *
       * وحجمه صغير عمداً: عمله استعلامان قصيران تحت قفل استشاري، والتزاحم
       * عليه يعني تزاحماً على الهدف نفسه — وهو ما يُراد تسلسله أصلاً.
       */
      provide: PIN_GUARD_DB,
      inject: [ConfigService],
      useFactory: (config: ConfigService): DbClient => {
        const pool = new Pool({
          connectionString: config.getOrThrow<string>('DATABASE_URL'),
          max: 5,
        });
        return drizzle(pool, { schema });
      },
    },
  ],
  exports: [DB, PIN_GUARD_DB],
})
export class DrizzleModule implements OnApplicationShutdown {
  constructor() {}
  async onApplicationShutdown() {
    // pool يُغلق مع العملية؛ الإغلاق الرشيق يتم في main.ts عبر enableShutdownHooks
  }
}
