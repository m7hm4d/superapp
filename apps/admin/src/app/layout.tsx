import type { Metadata } from 'next';
import { IBM_Plex_Sans_Arabic } from 'next/font/google';
import type { ReactNode } from 'react';
import './globals.css';
import { Providers } from './providers';
import {
  REVISION_RUNTIME_KEY,
  RUNTIME_KEY,
  serverApiUrl,
  serverRevision,
} from '@/lib/runtime-config';

const plexArabic = IBM_Plex_Sans_Arabic({
  subsets: ['arabic', 'latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-plex-arabic',
  display: 'swap',
});

export const metadata: Metadata = {
  title: {
    default: 'لوحة الإدارة',
    template: '%s — لوحة الإدارة',
  },
  description: 'لوحة إدارة منصة التوصيل المحلي',
};

// يُقرأ عند كل طلب لا عند البناء — فتصلح الصورة الواحدة لكل بيئة
export const dynamic = 'force-dynamic';

export default function RootLayout({ children }: { children: ReactNode }) {
  const apiUrl = serverApiUrl();
  const revision = serverRevision();
  return (
    <html lang="ar" dir="rtl" className={plexArabic.variable}>
      <head>
        {/* حقن قبل أي سكربت تطبيق: العميل يقرأه عند أول استدعاء */}
        <script
          dangerouslySetInnerHTML={{
            __html: [
              `window[${JSON.stringify(RUNTIME_KEY)}]=${JSON.stringify(apiUrl)}`,
              `window[${JSON.stringify(REVISION_RUNTIME_KEY)}]=${JSON.stringify(revision)}`,
            ].join(';'),
          }}
        />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
