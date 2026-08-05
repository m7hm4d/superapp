'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { hasTokens } from '@/lib/storage';

/** جذر اللوحة: جلسة موجودة → /overview، وإلا → /login. */
export default function IndexPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(hasTokens() ? '/overview' : '/login');
  }, [router]);

  return (
    <div className="flex h-screen items-center justify-center bg-surface-muted">
      <p className="text-sm text-zinc-500">جارٍ التحويل…</p>
    </div>
  );
}
