import { Controller, Get, Inject } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Public } from '../common/decorators';
import { DB, DbClient } from '../db/drizzle.module';

@Controller('health')
export class HealthController {
  constructor(@Inject(DB) private readonly db: DbClient) {}

  @Public()
  @Get()
  async check() {
    await this.db.execute(sql`SELECT 1`);
    return {
      status: 'ok',
      db: 'up',
      revision: process.env.APP_REVISION ?? 'unknown',
      at: new Date().toISOString(),
    };
  }
}
