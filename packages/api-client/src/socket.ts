import { io, type Socket as IoSocket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@superapp/shared';

export type Socket = IoSocket<ServerToClientEvents, ClientToServerEvents>;

export interface CreateSocketOptions {
  baseUrl: string;
  /**
   * تُستدعى عند كل محاولة اتصال (وليس مرة واحدة) — مرر دالة تعيد توكناً
   * صالحاً (مجدداً عند الحاجة) وإلا مات البث بصمت بعد انتهاء الـ 15 دقيقة
   * ووقعت الشاشات على الـ polling البطيء.
   */
  getToken: () => Promise<string | null>;
  /** توافق خلفي: توكن ثابت (يكفي للاختبارات فقط) */
  token?: string;
}

/**
 * اتصال Socket.io على namespace /rt.
 * تذكير: الـ socket تلميح فقط — عند إعادة الاتصال أعد جلب القوائم عبر REST.
 */
export function createSocket(opts: CreateSocketOptions): Socket {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const socket: Socket = io(`${base}/rt`, {
    transports: ['websocket'],
    // socket.io يقيّم الدالة عند كل محاولة اتصال — توكن حي دائماً
    auth: (cb) => {
      const fallback = { token: opts.token ?? '' };
      opts
        .getToken()
        .then((token) => cb(token ? { token } : fallback))
        .catch(() => cb(fallback));
    },
  });

  // فشل التوثيق في المصافحة: جرّب مجدداً بعد مهلة قصيرة (getToken سيجدد)
  socket.on('connect_error', () => {
    setTimeout(() => {
      if (!socket.connected) socket.connect();
    }, 2000);
  });

  return socket;
}
