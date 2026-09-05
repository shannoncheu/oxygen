import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: '续订 · 私人订阅管家',
  description: '订阅、账期与家庭共享，一个地方安心管理。',
  robots: { index: false, follow: false },
};
export const viewport = { width: 'device-width', initialScale: 1, viewportFit: 'cover' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
