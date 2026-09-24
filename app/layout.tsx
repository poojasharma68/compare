import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-inter',
});

const jetbrains = JetBrains_Mono({
  subsets: ['latin'],
  display: 'swap',
  variable: '--font-mono-stack',
});

export const metadata: Metadata = {
  title: 'UIX-Ray — Frontend UI & Responsive Testing',
  description:
    'Audit a live website against its Figma design and across every viewport, using DOM structure, computed CSS and element geometry rather than pixel diffing.',
};

export const viewport: Viewport = {
  themeColor: '#f6f7f9',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrains.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
