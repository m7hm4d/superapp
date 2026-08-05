'use client';

import { Inbox } from 'lucide-react';

export interface EmptyStateProps {
  title: string;
  body?: string;
}

export function EmptyState({ title, body }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <Inbox size={32} className="text-zinc-300" aria-hidden />
      <p className="text-sm font-medium text-zinc-600">{title}</p>
      {body && <p className="max-w-sm text-xs text-zinc-400">{body}</p>}
    </div>
  );
}
