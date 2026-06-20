import './global.css';
import { RootProvider } from 'fumadocs-ui/provider/next';
import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { inter, spaceGrotesk, jetbrainsMono } from '@/lib/fonts';

export const metadata: Metadata = {
  metadataBase: new URL('https://docs.anima.app'),
  title: {
    template: '%s — Anima docs',
    default: 'Anima docs',
  },
  description:
    'Anima is an agentic workspace where your own ai tools and your team read and write the same notes and canvas, sealed to storage you own. Docs for using Anima and connecting your own agent over anima-mcp.',
  keywords: [
    'Anima',
    'agentic workspace',
    'notes',
    'canvas',
    'anima-mcp',
    'MCP',
    'AI agents',
    'Sui',
    'Walrus',
    'Seal',
  ],
  openGraph: {
    type: 'website',
    siteName: 'Anima docs',
    url: 'https://docs.anima.app',
    title: 'Anima docs',
    description:
      'Notes on a shared canvas. Your own ai tools read and write them too.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Anima docs',
    description:
      'Notes on a shared canvas. Your own ai tools read and write them too.',
  },
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
