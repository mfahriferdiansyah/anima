'use client';
import { type ComponentProps, useState } from 'react';
import { useCopyButton } from 'fumadocs-ui/utils/use-copy-button';

const cache = new Map<string, Promise<string>>();

function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

/**
 * "Copy Markdown" page action: fetches the page's raw markdown (from the
 * per-page `.md` route) and copies it to the clipboard, so an agent or a
 * reader can grab the clean source of any docs page in one click.
 *
 * Self-contained on purpose: depends only on fumadocs-ui's copy hook and the
 * fumadocs preset's `fd-*` color tokens, so it adds no new packages.
 */
export function MarkdownCopyButton({
  markdownUrl,
  ...props
}: ComponentProps<'button'> & {
  /** URL that returns the raw markdown of this page (the `.md` route). */
  markdownUrl: string;
}) {
  const [isLoading, setLoading] = useState(false);
  const [checked, onClick] = useCopyButton(async () => {
    const cached = cache.get(markdownUrl);
    if (cached) return navigator.clipboard.writeText(await cached);

    setLoading(true);
    try {
      const promise = fetch(markdownUrl).then((res) => res.text());
      cache.set(markdownUrl, promise);
      await navigator.clipboard.writeText(await promise);
    } finally {
      setLoading(false);
    }
  });

  return (
    <button
      type="button"
      disabled={isLoading}
      onClick={onClick}
      {...props}
      className={[
        'inline-flex items-center gap-2 rounded-lg border border-fd-border bg-fd-secondary px-2.5 py-1.5 text-sm font-medium text-fd-secondary-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground disabled:opacity-60 [&_svg]:text-fd-muted-foreground',
        props.className ?? '',
      ].join(' ')}
    >
      {checked ? <CheckIcon /> : <CopyIcon />}
      {props.children ?? (checked ? 'Copied' : 'Copy markdown')}
    </button>
  );
}
