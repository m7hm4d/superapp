'use client';

import { X } from 'lucide-react';
import { useEffect, type ReactNode } from 'react';

export interface DrawerProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}

/**
 * درج التفاصيل: ينزلق من الحافة اليسرى (inline-end في RTL).
 * الصفحة تتحكم بالفتح عبر معامل id في useSearchParams — URL ثابت
 * قابل للمشاركة (الملف §7: «حالات وليست صفحات»).
 */
export function Drawer({ open, onClose, title, children, footer }: DrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <div
        className="animate-fade-in absolute inset-0 bg-black/40"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        className="animate-drawer-in absolute inset-y-0 end-0 flex w-full max-w-xl flex-col bg-white shadow-2xl"
      >
        <header className="flex items-center justify-between gap-3 border-b border-zinc-200 px-5 py-4">
          <h2 className="text-base font-semibold text-zinc-900">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="إغلاق"
            className="rounded-lg p-1.5 text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-800"
          >
            <X size={18} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto p-5">{children}</div>
        {footer && (
          <footer className="border-t border-zinc-200 bg-surface-muted/50 px-5 py-4">
            {footer}
          </footer>
        )}
      </div>
    </div>
  );
}
