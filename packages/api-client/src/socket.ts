import { io, type Socket as IoSocket } from 'socket.io-client';
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from '@superapp/shared';

export type Socket = IoSocket<ServerToClientEvents, ClientToServerEvents>;

export interface CreateSocketOptions {
  baseUrl: string;
  token: string;
}

/**
 * اتصال Socket.io على namespace /rt.
 * تذكير: الـ socket تلميح فقط — عند إعادة الاتصال أعد جلب القوائم عبر REST.
 */
export function createSocket(opts: CreateSocketOptions): Socket {
  const base = opts.baseUrl.replace(/\/+$/, '');
  const socket: Socket = io(`${base}/rt`, {
    transports: ['websocket'],
    auth: { token: opts.token },
  });
  return socket;
}
