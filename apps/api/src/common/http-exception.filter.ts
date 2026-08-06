import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { REQUEST_ID_HEADER } from '@superapp/shared';

/** استجابات خطأ موحدة لا تسرّب الداخليات، مع requestId للدعم */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();
    const req = ctx.getRequest();
    const requestId = req.id ?? req.headers[REQUEST_ID_HEADER];

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const payload = typeof body === 'string' ? { code: 'ERROR', message: body } : body;
      res.status(status).json({ ...payload, requestId });
      return;
    }

    // خطأ غير متوقع: سجّل التفاصيل، أعد رسالة عامة فقط
    // eslint-disable-next-line no-console
    console.error({ err: exception, requestId }, 'unhandled exception');
    if (process.env.SENTRY_DSN) {
      // استيراد كسول حتى لا يمس المسار الحرج عند غياب الإعداد
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const Sentry = require('@sentry/node') as typeof import('@sentry/node');
      Sentry.captureException(exception, { extra: { requestId } });
    }
    res.status(HttpStatus.INTERNAL_SERVER_ERROR).json({
      code: 'INTERNAL_ERROR',
      message: 'خطأ غير متوقع',
      requestId,
    });
  }
}
