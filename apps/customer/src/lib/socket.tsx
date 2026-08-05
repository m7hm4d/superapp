import { createSocket } from '@superapp/api-client';
import { useQueryClient } from '@tanstack/react-query';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuthStore } from '../stores/auth';
import { api, BASE_URL } from './api';

type AppSocket = ReturnType<typeof createSocket>;

interface SocketContextValue {
  socket: AppSocket | null;
  /** false = مقطوع → OfflineBar؛ الضيف بلا socket يُعتبر متصلاً */
  connected: boolean;
}

const SocketContext = createContext<SocketContextValue>({ socket: null, connected: true });

export function useSocket(): SocketContextValue {
  return useContext(SocketContext);
}

/**
 * يتصل بـ /rt عند تسجيل الدخول. القاعدة (§10): الـ socket تلميح فقط —
 * عند أي اتصال/إعادة اتصال نعيد جلب القوائم عبر REST.
 */
export function SocketProvider({ children }: { children: React.ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const queryClient = useQueryClient();
  const [socket, setSocket] = useState<AppSocket | null>(null);
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    if (status !== 'authed') {
      setSocket(null);
      setConnected(true);
      return;
    }

    let disposed = false;
    let instance: AppSocket | null = null;

    void api.storage.getAccess().then((token) => {
      if (disposed || !token) return;
      instance = createSocket({ baseUrl: BASE_URL, token });

      instance.on('connect', () => {
        setConnected(true);
        // إعادة اتصال = حالة مجهولة؛ الحقيقة عبر REST دائماً
        void queryClient.invalidateQueries();
      });
      instance.on('disconnect', () => setConnected(false));
      instance.on('order:status', (e) => {
        void queryClient.invalidateQueries({ queryKey: ['order', e.orderId] });
        void queryClient.invalidateQueries({ queryKey: ['orders'] });
      });
      instance.on('config:updated', () => {
        void queryClient.invalidateQueries({ queryKey: ['config'] });
      });

      setSocket(instance);
      setConnected(instance.connected);
    });

    return () => {
      disposed = true;
      instance?.disconnect();
      setSocket(null);
      setConnected(true);
    };
  }, [status, queryClient]);

  return <SocketContext.Provider value={{ socket, connected }}>{children}</SocketContext.Provider>;
}
