'use client';

import { Monitor, Smartphone } from 'lucide-react';
import { cn } from '@/lib/cn';

/**
 * متصفح/نظام مختصر من user-agent — يكفي لتمييز الأجهزة دون عرض السلسلة كاملة.
 */
export function deviceLabel(ua: string | null): string {
  if (!ua) return 'جهاز غير معروف';
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /Chrome\//.test(ua)
      ? 'Chrome'
      : /Safari\//.test(ua) && !/Chrome/.test(ua)
        ? 'Safari'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /okhttp|Expo|ReactNative/i.test(ua)
            ? 'تطبيق الجوال'
            : 'متصفح آخر';
  const os = /iPhone|iPad|iOS/.test(ua)
    ? 'iOS'
    : /Android/.test(ua)
      ? 'Android'
      : /Mac OS X/.test(ua)
        ? 'macOS'
        : /Windows/.test(ua)
          ? 'Windows'
          : /Linux/.test(ua)
            ? 'Linux'
            : '';
  return os ? `${browser} — ${os}` : browser;
}

function isHandheld(ua: string | null): boolean {
  return ua !== null && /iPhone|iPad|Android|Mobile|okhttp|Expo|ReactNative/i.test(ua);
}

/**
 * أيقونة + اسم الجهاز.
 *
 * كان العمود نصّاً وحده، فيقرأ المشرف ستّة صفوف متشابهة الطول بحثاً عن
 * الغريب فيها. والشكل يُميَّز قبل النصّ: هاتف بين حواسيب يُرى بلمحة —
 * وهو ما تفعله قوائم الجلسات في GitHub وLinear وAirwallex.
 */
export function DeviceCell({ ua }: { ua: string | null }) {
  const Icon = isHandheld(ua) ? Smartphone : Monitor;
  return (
    <span className="flex items-center gap-2 whitespace-nowrap" title={ua ?? undefined}>
      <Icon size={15} className="shrink-0 text-zinc-400" aria-hidden />
      {deviceLabel(ua)}
    </span>
  );
}

/** أيقونة الجهاز في مربّع — لبطاقة الجلسة الحالية. */
export function DeviceAvatar({ ua, className }: { ua: string | null; className?: string }) {
  const Icon = isHandheld(ua) ? Smartphone : Monitor;
  return (
    <span
      className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white ring-1',
        className,
      )}
    >
      <Icon size={18} aria-hidden />
    </span>
  );
}
