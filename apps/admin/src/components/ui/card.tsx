'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface CardProps {
  title?: ReactNode;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}

export function Card({ title, children, className, actions }: CardProps) {
  return (
    <section
      className={cn(
        'rounded-card border border-zinc-200 bg-white shadow-sm',
        className,
      )}
    >
      {(title !== undefined || actions !== undefined) && (
        <header className="flex items-center justify-between gap-3 border-b border-zinc-100 px-5 py-4">
          {title !== undefined ? (
            <h2 className="text-base font-semibold text-zinc-900">{title}</h2>
          ) : (
            <span />
          )}
          {actions && <div className="flex items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}
