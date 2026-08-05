import React, {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { createSocket } from '@superapp/api-client';
import type {
  BatchStatusEvent,
  NewOrderEvent,
  OrderStatusEvent,
  SettlementUpdatedEvent,
} from '@superapp/shared';
import { API_BASE_URL, api, storage } from './api';
import { useAuthStore } from '../stores/auth';
import { useAlertStore } from '../stores/alert';

interface SocketContextValue {
  /** متصل الآن؟ يُستخدم لإظهار OfflineBar وتعطيل العمليات الحساسة */
  connected: boolean;
}

const SocketContext = createContext<SocketContextValue>({ connected: false });

export function useSocketStatus(): SocketContextValue {
  return useContext(SocketContext);
}

type AppSocket = ReturnType<typeof createSocket>;

/**
 * يتصل عند المصادقة فقط. القاعدة: الـsocket تلميح — عند أي حدث أو إعادة اتصال
 * نبطل صلاحية الاستعلامات ونعيد الجلب عبر REST (مصدر الحقيقة).
 */
export function SocketProvider({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const socketRef = useRef<AppSocket | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function connect() {
      const token = await storage.getAccess();
      if (cancelled || !token) return;

      // getToken يُقيَّم عند كل محاولة اتصال — يجدد التوكن فلا يموت البث بعد 15 دقيقة
      const socket = createSocket({
        baseUrl: API_BASE_URL,
        getToken: () => api.getFreshAccessToken(),
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        if (cancelled) return;
        setConnected(true);
        // عند (إعادة) الاتصال: قد تكون فاتتنا أحداث — أعد جلب كل القوائم النشطة
        void queryClient.invalidateQueries();
      });
      socket.on('disconnect', () => {
        if (!cancelled) setConnected(false);
      });

      socket.on('order:new', (e: NewOrderEvent) => {
        if (cancelled) return;
        useAlertStore.getState().push(e);
        void queryClient.invalidateQueries({ queryKey: ['vendor-orders'] });
        void queryClient.invalidateQueries({ queryKey: ['vendor-order'] });
      });
      socket.on('order:status', (_e: OrderStatusEvent) => {
        if (cancelled) return;
        void queryClient.invalidateQueries({ queryKey: ['vendor-orders'] });
        void queryClient.invalidateQueries({ queryKey: ['vendor-order'] });
        void queryClient.invalidateQueries({ queryKey: ['vendor-ledger'] });
      });
      socket.on('batch:status', (_e: BatchStatusEvent) => {
        if (cancelled) return;
        void queryClient.invalidateQueries({ queryKey: ['vendor-batches'] });
      });
      socket.on('settlement:updated', (_e: SettlementUpdatedEvent) => {
        if (cancelled) return;
        void queryClient.invalidateQueries({ queryKey: ['vendor-ledger'] });
      });
      socket.on('config:updated', () => {
        if (cancelled) return;
        void queryClient.invalidateQueries({ queryKey: ['config'] });
      });
    }

    if (status === 'authed') {
      void connect();
    }

    return () => {
      cancelled = true;
      setConnected(false);
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [status, queryClient]);

  return <SocketContext.Provider value={{ connected }}>{children}</SocketContext.Provider>;
}
