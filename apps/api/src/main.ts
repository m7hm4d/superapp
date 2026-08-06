import './register-paths';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import * as Sentry from '@sentry/node';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';

// تتبع الأخطاء اختياري بالكامل — يعمل فقط عند ضبط SENTRY_DSN
if (process.env.SENTRY_DSN) {
  Sentry.init({ dsn: process.env.SENTRY_DSN, environment: process.env.NODE_ENV });
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService);

  /**
   * خلف وكيل عكسي (‏Caddy) عنوان المقبس هو عنوان الوكيل، فيصير كل الزوار
   * عنواناً واحداً: حدّ محاولات المصادقة يصبح مشتركاً بين الجميع، وسجل
   * الدخول يقيّد عنوان الوكيل بدل عنوان الأدمن. القيمة = عدد الوكلاء
   * الموثوقين بيننا وبين الإنترنت (‏Caddy وحده = 1).
   *
   * شرط لازم: يجب أن يستبدل الوكيل ترويسة X-Forwarded-For لا أن يلحق بها،
   * وإلا زوّرها العميل. راجع `header_up X-Forwarded-For` في deploy/Caddyfile.
   */
  const trustProxy = config.getOrThrow<number>('TRUST_PROXY');
  if (trustProxy > 0) app.set('trust proxy', trustProxy);

  const origins = config
    .getOrThrow<string>('CORS_ORIGINS')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  app.use(helmet());
  app.enableCors({ origin: origins, credentials: true });
  app.setGlobalPrefix('api/v1');
  app.enableShutdownHooks();

  const port = config.getOrThrow<number>('PORT');
  await app.listen(port);
}

void bootstrap();
