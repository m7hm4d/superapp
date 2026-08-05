'use client';

import {
  AlertTriangle,
  LayoutDashboard,
  LogOut,
  Package,
  Settings,
  Truck,
  UserCheck,
  Users,
  Wallet,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { SidebarNav, type SidebarNavLink } from '@/components/ui';
import { RequireAuth, useAuth } from '@/lib/auth';

const NAV_LINKS: SidebarNavLink[] = [
  { href: '/overview', label: 'نظرة عامة', icon: LayoutDashboard },
  { href: '/orders', label: 'الطلبات', icon: Package },
  { href: '/batches', label: 'الدفعات', icon: Truck },
  { href: '/approvals', label: 'الموافقات', icon: UserCheck },
  { href: '/users', label: 'المستخدمون', icon: Users },
  { href: '/exceptions', label: 'الاستثناءات', icon: AlertTriangle },
  { href: '/finance', label: 'النقد والتسويات', icon: Wallet },
  { href: '/settings', label: 'الإعدادات', icon: Settings },
];

/**
 * غلاف مجموعة (dashboard): حارس الجلسة + الشريط الجانبي.
 * dir=rtl على html — العنصر الأول في الـflex يظهر يميناً تلقائياً.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  const { user, logout } = useAuth();

  return (
    <RequireAuth>
      <div className="flex h-screen overflow-hidden bg-surface-muted">
        <aside className="flex w-60 shrink-0 flex-col border-e border-zinc-200 bg-white">
          <div className="flex items-center gap-2.5 border-b border-zinc-100 px-5 py-5">
            <span className="h-2.5 w-2.5 rounded-full bg-brand-600" aria-hidden />
            <span className="text-lg font-bold text-zinc-900">لوحة الإدارة</span>
          </div>
          <div className="flex-1 overflow-y-auto py-3">
            <SidebarNav links={NAV_LINKS} />
          </div>
          <div className="border-t border-zinc-100 p-3">
            {user && (
              <p className="truncate px-3 pb-2 text-xs text-zinc-500">
                {user.fullName}
              </p>
            )}
            <button
              type="button"
              onClick={() => void logout()}
              className="flex min-h-touch w-full items-center gap-3 rounded-xl px-3 text-sm font-medium text-zinc-600 transition hover:bg-red-50 hover:text-red-700"
            >
              <LogOut size={18} className="text-zinc-400" aria-hidden />
              <span>تسجيل الخروج</span>
            </button>
          </div>
        </aside>
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-7xl p-6">{children}</div>
        </main>
      </div>
    </RequireAuth>
  );
}
