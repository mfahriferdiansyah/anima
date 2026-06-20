import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center px-6 py-20 sm:py-28">
      <div className="w-full max-w-3xl">
        {/* Hero */}
        <section className="text-center">
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

        {/* Two cards */}
        <section className="mt-14 grid gap-5 sm:grid-cols-2">
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
      </div>
    </main>
  );
}
