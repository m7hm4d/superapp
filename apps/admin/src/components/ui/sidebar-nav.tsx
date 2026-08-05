'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/cn';

export interface SidebarNavLink {
  href: string;
  label: string;
  icon?: LucideIcon;
}

export function SidebarNav({ links }: { links: SidebarNavLink[] }) {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5 px-3" aria-label="التنقل الرئيسي">
      {links.map(({ href, label, icon: Icon }) => {
        const active = pathname === href || pathname.startsWith(`${href}/`);
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex min-h-touch items-center gap-3 rounded-xl px-3 text-sm font-medium transition',
              active
                ? 'bg-brand-50 text-brand-800'
                : 'text-zinc-600 hover:bg-zinc-50 hover:text-zinc-900',
            )}
          >
            {Icon && (
              <Icon
                size={18}
                className={active ? 'text-brand-600' : 'text-zinc-400'}
                aria-hidden
              />
            )}
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}
