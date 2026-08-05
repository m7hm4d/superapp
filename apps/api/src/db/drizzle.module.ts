import { Global, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle, NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

export const DB = Symbol('DB');
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
  ],
  exports: [DB],
})
export class DrizzleModule implements OnApplicationShutdown {
  constructor() {}
  async onApplicationShutdown() {
    // pool يُغلق مع العملية؛ الإغلاق الرشيق يتم في main.ts عبر enableShutdownHooks
  }
}
