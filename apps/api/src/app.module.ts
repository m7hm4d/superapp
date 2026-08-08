import { Module, RequestMethod } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { REQUEST_ID_HEADER } from '@superapp/shared';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import { ApprovedGuard } from './common/approved.guard';
import { AllExceptionsFilter } from './common/http-exception.filter';
import { IdempotencyPurgeService } from './common/idempotency-purge.service';
import { IdempotencyInterceptor } from './common/idempotency.interceptor';
import { JwtAuthGuard } from './common/jwt-auth.guard';
import { RolesGuard } from './common/roles.guard';
import { validateEnv } from './config/env.schema';
import { DrizzleModule } from './db/drizzle.module';
import { HealthController } from './health/health.controller';
import { AuthModule } from './modules/auth/auth.module';
import { DeliveriesModule } from './modules/deliveries/deliveries.module';
import { FlagsModule } from './modules/flags/flags.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { OrdersModule } from './modules/orders/orders.module';
import { PushModule } from './modules/push/push.module';
import { VendorsModule } from './modules/vendors/vendors.module';
import { AdminModule } from './modules/admin/admin.module';
import { RealtimeModule } from './realtime/realtime.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv }),
    LoggerModule.forRoot({
      // الافتراضي في nestjs-pino هو '*' وقد أزالته path-to-regexp v8 (Express 5)،
      // فينبّه Nest ويحوّله تلقائياً. نصرّح بالشكل الجديد نفسه لإسكات التحذير بلا تغيير سلوك.
      forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
      pinoHttp: {
        genReqId: (req, res) => {
          const incoming = req.headers[REQUEST_ID_HEADER];
          const id = typeof incoming === 'string' && incoming.length <= 64 ? incoming : randomUUID();
          res.setHeader(REQUEST_ID_HEADER, id);
          return id;
        },
        // قائمة صريحة لا قاعدة عامة: حقل حسّاس يُضاف ولا يُدرج هنا يُطبع
        // كاملاً في السجلّ، ولا شيء ينبّه. تُراجَع مع كل حقل سرّي جديد.
        redact: {
          paths: [
            'req.headers.authorization',
            'req.body.password',
            'req.body.currentPassword',
            'req.body.newPassword',
            'req.body.refreshToken',
            'req.body.totp',
            'req.body.recoveryCode',
            'req.body.secret',
            'res.body.codes',
          ],
          censor: '[redacted]',
        },
        transport:
          process.env.NODE_ENV === 'development' ? { target: 'pino-pretty' } : undefined,
      },
    }),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    // الاسم 'default' مقصود: تجاوزات @Throttle تُطابَق بالاسم، وأي اسم آخر
    // يجعل حدود مسارات المصادقة تُهمَل بصمت ويبقى الحد العام وحده.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    JwtModule.register({ global: true }),
    DrizzleModule,
    RealtimeModule,
    AuthModule,
    VendorsModule,
    OrdersModule,
    LedgerModule,
    DeliveriesModule,
    FlagsModule,
    PushModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: ApprovedGuard },
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    IdempotencyPurgeService,
  ],
})
export class AppModule {}
