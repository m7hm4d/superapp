import { createSocket } from '@superapp/api-client';
import { useQueryClient } from '@tanstack/react-query';
import React, { createContext, useContext, useEffect, useState } from 'react';
import { useAuthStore } from '../stores/auth';
import { API_URL, storage } from './api';

type AppSocket = ReturnType<typeof createSocket>;

interface SocketContextValue {
  socket: AppSocket | null;
  connected: boolean;
}

const SocketContext = createContext<SocketContextValue>({ socket: null, connected: false });

export function useSocket(): SocketContextValue {
  return useContext(SocketContext);
}

/**
 * يتصل عند المصادقة فقط. الـ socket تلميح وليس مصدر حقيقة:
 * أي إعادة اتصال تبطل كل الاستعلامات النشطة (إعادة جلب عبر REST).
 */
export function SocketProvider({ children }: { children: React.ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const queryClient = useQueryClient();
  const [value, setValue] = useState<SocketContextValue>({ socket: null, connected: false });

  useEffect(() => {
    if (status !== 'authed') {
      setValue({ socket: null, connected: false });
      return;
    }
    let disposed = false;
    let socket: AppSocket | null = null;

    void (async () => {
      const token = await storage.getAccess();
      if (disposed || !token) return;
      socket = createSocket({ baseUrl: API_URL, token });

      socket.on('connect', () => setValue({ socket, connected: true }));
      socket.on('disconnect', () => setValue({ socket, connected: false }));
      socket.io.on('reconnect', () => {
        void queryClient.invalidateQueries();
      });

      // ربط الأحداث بإبطال الاستعلامات — الشاشات تضيف معالجات فورية خاصة بها
      socket.on('batch:offered', () => {
        void queryClient.invalidateQueries({ queryKey: ['batches', 'available'] });
      });
      socket.on('batch:status', () => {
        void queryClient.invalidateQueries({ queryKey: ['batches'] });
      });
      socket.on('order:status', () => {
        void queryClient.invalidateQueries({ queryKey: ['batches', 'active'] });
      });

      setValue({ socket, connected: socket.connected });
    })();

    return () => {
      disposed = true;
      socket?.disconnect();
    };
  }, [status, queryClient]);

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}
