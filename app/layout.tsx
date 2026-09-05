import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = {
  title: 'oxygen',
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
