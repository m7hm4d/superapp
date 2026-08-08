'use client';

import { useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { Badge, type BadgeTone } from '@/components/ui';
import { cn } from '@/lib/cn';

export interface SecurityRowProps {
  title: string;
  /** جملة واحدة تشرح ما يفعله هذا العامل — لا فقرة */
  description: string;
  status: { label: string; tone: BadgeTone };
  /** نصّ الزرّ الذي يفتح النموذج */
  action: string;
  children: ReactNode;
  /** يُفتح ابتداءً — لما يحتاج انتباهاً فورياً */
  defaultOpen?: boolean;
}

/**
 * صفّ إعداد أمني: عنوان وحالة وزرّ يكشف النموذج.
 *
 * كانت الشاشة أربعة نماذج مفتوحة معاً في عمود واحد، فلا يُرى الوضع الأمني
 * إلا بتمرير طويل، ويختلط ما يحتاج انتباهاً بما لا يحتاجه. والنماذج المفتوحة
 * دائماً تدعو إلى تغيير لم يُقصد.
 *
 * فالحالة تُقرأ من سطر واحد، والنموذج يُفتح عند القصد — وهو ما تفعله لوحات
 * الأمان في Mercury وAirwallex وPipedrive.
 */
export function SecurityRow({
  title,
  description,
  status,
  action,
  children,
  defaultOpen = false,
}: SecurityRowProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="border-b border-zinc-200 py-4 last:border-b-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-zinc-900">{title}</h3>
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>
          <p className="mt-1 text-sm text-zinc-500">{description}</p>
        </div>

        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
        >
          {open ? 'إغلاق' : action}
          <ChevronDown
            size={15}
            aria-hidden
            className={cn('transition-transform', open && 'rotate-180')}
          />
        </button>
      </div>

      {open && <div className="mt-4">{children}</div>}
    </div>
  );
}
