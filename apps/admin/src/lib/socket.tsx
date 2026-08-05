'use client';

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createSocket, type Socket } from '@superapp/api-client';
import type { ServerToClientEvents } from '@superapp/shared';
import { API_BASE_URL } from './api';
import { useAuth } from './auth';
import { getAccessTokenSync } from './storage';

const SocketContext = createContext<Socket | null>(null);

/**
 * يتصل بـ /rt عند وجود جلسة إدارية.
 * الـsocket تلميح فقط: أي حدث يبطل الاستعلامات ذات الصلة، وإعادة
 * الاتصال تبطل كل شيء — الحقيقة دائماً عبر REST.
 */
export function SocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    if (!user) {
      setSocket(null);
      return;
    }
    const token = getAccessTokenSync();
    if (!token) return;

    const s = createSocket({ baseUrl: API_BASE_URL, token });

    const invalidate = (...keys: string[][]) => {
      for (const key of keys) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
    };

    s.on('order:new', () => {
      invalidate(['admin', 'orders'], ['admin', 'overview']);
    });
    s.on('order:status', () => {
      invalidate(
        ['admin', 'orders'],
        ['admin', 'overview'],
        ['admin', 'stuck-orders'],
        ['admin', 'exceptions'],
        ['admin', 'finance'],
      );
    });
    s.on('batch:offered', () => {
      invalidate(['admin', 'batches'], ['admin', 'overview']);
    });
    s.on('batch:status', () => {
      invalidate(
        ['admin', 'batches'],
        ['admin', 'orders'],
        ['admin', 'overview'],
      );
    });
    s.on('config:updated', () => {
      invalidate(['admin', 'flags'], ['admin', 'cities']);
    });
    s.io.on('reconnect', () => {
      void queryClient.invalidateQueries();
    });

    setSocket(s);
    return () => {
      s.disconnect();
      setSocket(null);
    };
  }, [user, queryClient]);

  return (
    <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
  );
}

export function useSocket(): Socket | null {
  return useContext(SocketContext);
}

/** مستمع داخلي بلا أنواع socket.io المعقدة — الواجهة العامة تبقى مفحوصة. */
interface UntypedEmitter {
  on(event: string, listener: (...args: unknown[]) => void): void;
  off(event: string, listener: (...args: unknown[]) => void): void;
}

/**
 * useSocketEvent('order:status', (e) => { ... }) — يعاد الربط تلقائياً
 * عند تبدل الاتصال، وأحدث handler يُستدعى دائماً (بلا stale closure).
 */
export function useSocketEvent<E extends keyof ServerToClientEvents>(
  event: E,
  handler: ServerToClientEvents[E],
): void {
  const socket = useSocket();
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!socket) return;
    const listener = (...args: unknown[]) => {
      (handlerRef.current as (...a: unknown[]) => void)(...args);
    };
    const emitter = socket as unknown as UntypedEmitter;
    emitter.on(event, listener);
    return () => {
      emitter.off(event, listener);
    };
  }, [socket, event]);
}
