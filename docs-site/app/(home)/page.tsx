import Link from 'next/link';

const featured = [
  {
    href: '/docs/build/quickstart',
    eyebrow: 'Build',
    title: 'Quickstart',
    blurb: 'Connect your own agent to a vault over anima-mcp in about ten minutes.',
  },
  {
    href: '/docs/build/mcp-reference',
    eyebrow: 'Build',
    title: 'MCP reference',
    blurb: 'The four tools your agent can call: recall, remember, list, read.',
  },
  {
    href: '/docs/build/concepts/custody-and-ownership',
    eyebrow: 'Concepts',
    title: 'How it works',
    blurb: 'Custody, the two-key model, Seal, Walrus, and resurrection.',
  },
  {
    href: '/docs/build/self-hosting',
    eyebrow: 'Operate',
    title: 'Self-host',
    blurb: 'Run your own instance against a vault you already own.',
  },
];

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center px-6 py-20 sm:py-28">
      <div className="w-full max-w-5xl">
        {/* Hero */}
        <section className="mx-auto max-w-3xl text-center">
          <p className="inline-flex items-center gap-1.5 text-sm font-semibold tracking-[0.16em] uppercase text-[var(--color-anima-orange)]">
            <span className="anima-star text-base leading-none">✦</span>
            docs
          </p>

          <h1 className="mt-5 font-[family-name:var(--font-heading)] text-6xl sm:text-7xl font-bold tracking-[-0.03em] text-fd-foreground">
            Anima
          </h1>

          <p className="mx-auto mt-6 max-w-xl text-lg sm:text-xl leading-relaxed text-fd-foreground">
            Notes on a shared canvas. Your own ai tools read and write them too.
          </p>

          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-fd-muted-foreground">
            Anima is an agentic workspace where your own AI agents and your team
            read and write the same notes and canvas, sealed to storage you own,
            so it survives any app.
          </p>
        </section>

        {/* Two tracks */}
        <section className="mx-auto mt-14 grid max-w-3xl gap-5 sm:grid-cols-2">
          <Link
            href="/docs/use/getting-started"
            className="group flex flex-col rounded-[14px] border border-fd-border bg-fd-card p-6 transition-all hover:-translate-y-1 hover:border-[var(--color-anima-blue)] hover:shadow-[0_14px_36px_rgba(22,24,29,0.09)]"
          >
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-anima-blue)]">
              Use Anima
            </span>
            <h2 className="mt-3 font-[family-name:var(--font-heading)] text-xl font-bold tracking-[-0.02em] text-fd-foreground">
              Capture, ask, and export
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">
              Capture notes, ask the companion, publish and export.
            </p>
            <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-anima-blue)]">
              Getting started
              <span className="transition-transform group-hover:translate-x-1">
                →
              </span>
            </span>
          </Link>

          <Link
            href="/docs/build/quickstart"
            className="group flex flex-col rounded-[14px] border border-fd-border bg-fd-card p-6 transition-all hover:-translate-y-1 hover:border-[var(--color-anima-orange)] hover:shadow-[0_14px_36px_rgba(22,24,29,0.09)]"
          >
            <span className="text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-anima-orange)]">
              Build with Anima
            </span>
            <h2 className="mt-3 font-[family-name:var(--font-heading)] text-xl font-bold tracking-[-0.02em] text-fd-foreground">
              Connect your own agent
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-fd-muted-foreground">
              Connect your own agent to a vault via anima-mcp.
            </p>
            <span className="mt-5 inline-flex items-center gap-1.5 text-sm font-semibold text-[var(--color-anima-orange)]">
              Quickstart
              <span className="transition-transform group-hover:translate-x-1">
                →
              </span>
            </span>
          </Link>
        </section>

        {/* What's inside */}
        <section className="mt-20">
          <div className="mb-6 flex items-baseline justify-between border-b border-fd-border pb-3">
            <h2 className="font-[family-name:var(--font-heading)] text-sm font-bold uppercase tracking-[0.14em] text-fd-muted-foreground">
              What&apos;s inside
            </h2>
            <Link
              href="/docs/build/quickstart"
              className="text-sm font-semibold text-[var(--color-anima-blue)] hover:text-[var(--color-anima-blue-deep)]"
            >
              All docs →
            </Link>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {featured.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="group flex flex-col rounded-[14px] border border-fd-border bg-fd-card p-5 transition-all hover:-translate-y-0.5 hover:border-[var(--color-anima-blue)] hover:shadow-[0_10px_28px_rgba(22,24,29,0.07)]"
              >
                <span className="text-[0.6875rem] font-bold uppercase tracking-[0.12em] text-fd-muted-foreground">
                  {item.eyebrow}
                </span>
                <span className="mt-2 font-[family-name:var(--font-heading)] text-base font-bold tracking-[-0.01em] text-fd-foreground group-hover:text-[var(--color-anima-blue)]">
                  {item.title}
                </span>
                <span className="mt-1.5 text-sm leading-relaxed text-fd-muted-foreground">
                  {item.blurb}
                </span>
              </Link>
            ))}
          </div>
        </section>

        {/* Agent-readable strip */}
        <section className="mt-12 rounded-[14px] border border-fd-border bg-fd-muted/60 p-7 sm:p-8">
          <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="max-w-xl">
              <p className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-[0.14em] text-[var(--color-anima-orange)]">
                <span className="anima-star text-sm leading-none">✦</span>
                These docs are agent-readable
              </p>
              <p className="mt-3 text-sm leading-relaxed text-fd-muted-foreground">
                Every page is available as clean markdown, and the whole site is
                indexed for agents. Point your coding agent at{' '}
                <code className="rounded bg-fd-background px-1.5 py-0.5 text-[0.8125rem] text-fd-foreground">
                  llms.txt
                </code>
                , or hit the copy-as-markdown button on any page to hand the raw
                source to a model.
              </p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-2.5">
              <a
                href="/llms.txt"
                className="inline-flex items-center gap-1.5 rounded-lg border border-fd-border bg-fd-card px-3.5 py-2 text-sm font-semibold text-fd-foreground transition-colors hover:border-[var(--color-anima-blue)] hover:text-[var(--color-anima-blue)]"
              >
                llms.txt
              </a>
              <a
                href="/llms-full.txt"
                className="inline-flex items-center gap-1.5 rounded-lg border border-fd-border bg-fd-card px-3.5 py-2 text-sm font-semibold text-fd-foreground transition-colors hover:border-[var(--color-anima-blue)] hover:text-[var(--color-anima-blue)]"
              >
                llms-full.txt
              </a>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
