import { Inter, Space_Grotesk, JetBrains_Mono } from 'next/font/google';

// Inter = body, Space Grotesk = headings + logo, JetBrains Mono = code.
// Each exposes a CSS variable the brand css in global.css reads.
export const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

export const spaceGrotesk = Space_Grotesk({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-space-grotesk',
  display: 'swap',
});

export const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '700'],
  variable: '--font-jetbrains-mono',
  display: 'swap',
});
