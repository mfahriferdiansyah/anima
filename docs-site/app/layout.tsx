import './global.css';
import { RootProvider } from 'fumadocs-ui/provider/next';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { inter, spaceGrotesk, jetbrainsMono } from '@/lib/fonts';

export const metadata: Metadata = {
  title: {
    template: '%s — Anima docs',
    default: 'Anima',
  },
  description:
    'Notes on a shared canvas. Your own ai tools read and write them too.',
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${spaceGrotesk.variable} ${jetbrainsMono.variable}`}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen">
        <RootProvider
          search={{
            // Static export: read the pre-built search index from
            // /api/search/route.ts (staticGET) instead of a live API.
            options: { type: 'static' },
          }}
        >
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
